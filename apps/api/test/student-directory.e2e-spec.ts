import { PrismaService } from '../src/common/prisma.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { AuthPrincipal } from '../src/auth/auth.service';

describe('Readiness directory database sorting', () => {
  const db = new PrismaService();
  const admin = { role: 'ADMIN' } as AuthPrincipal;
  it('sorts latest scores, zero, ties and nulls globally before pagination', async () => {
    // Roll back these isolated local test fixtures without touching other records.
    const rollback = new Error('fixture rollback');
    try {
      await db.$transaction(async tx => {
        const department = await tx.department.create({ data: { code: 'SORT-TEST', name: 'Sort test' } });
        const batch = await tx.batch.create({ data: { batchIdentifier: 'SORT-TEST', academicYear: '2028', departmentId: department.id } });
        for (let i = 0; i < 28; i++) {
          const student = await tx.student.create({ data: { studentId: `SORT-TEST-${String(i).padStart(2, '0')}`, name: 'Readiness sort fixture', batchId: batch.id } });
          if (i === 27) continue;
          await tx.readinessAssessment.create({ data: { studentId: student.id, sourceResultId: 'old', sourceBatchId: 'test', readinessScore: 250, verificationStatus: 'PENDING', parameterScores: {}, assessedAt: new Date('2026-01-01') } });
          await tx.readinessAssessment.create({ data: { studentId: student.id, sourceResultId: 'latest', sourceBatchId: 'test', readinessScore: i === 26 ? 25 : i, verificationStatus: 'PENDING', parameterScores: {}, assessedAt: new Date('2026-02-01') } });
        }
        const service = new ProfilesService(tx as unknown as PrismaService);
        const asc = await service.listForStaff(admin, 'SORT-TEST-', 1, 'readiness_asc');
        const ascLast = await service.listForStaff(admin, 'SORT-TEST-', 2, 'readiness_asc');
        const desc = await service.listForStaff(admin, 'SORT-TEST-', 1, 'readiness_desc');
        const descLast = await service.listForStaff(admin, 'SORT-TEST-', 2, 'readiness_desc');
        expect(asc.total).toBe(28);
        expect(asc.students.map(s => s.readinessScore)).toEqual(Array.from({ length: 25 }, (_, i) => i));
        expect(ascLast.students.map(s => s.readinessScore)).toEqual([25, 25, null]);
        expect(desc.students.slice(0, 2).map(s => s.studentId)).toEqual(['SORT-TEST-25', 'SORT-TEST-26']);
        expect(descLast.students.map(s => s.readinessScore)).toEqual([1, 0, null]);
        expect((await service.listForStaff(admin, 'SORT-TEST-27', 1, 'readiness_desc')).students[0].readinessScore).toBeNull();
        throw rollback;
      }, { timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
  }, 30000);
  afterAll(async () => { await db.$disconnect(); });
});
