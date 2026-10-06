import { ProfilesService } from '../src/profiles/profiles.service';
import { AuthPrincipal } from '../src/auth/auth.service';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
const { parseAllocations } = require('../scripts/import-roster-allocations.cjs');

describe('Imported college allocations', () => {
  const header = ['Sl.No', 'Register Number', 'Name of the Student', 'Dept', 'College', null, 'Training Level'];
  const row = [1, 312325000001, 'Roster Student', 'CSE', "St JOSEPH'S ENGINEERING", 'HOPE Elite', 'Full Stack + AI'];

  it('retains training groups and levels exactly and records duplicate source rows', () => {
    const parsed = parseAllocations([header, row, [2, ...row.slice(1)]]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.records[0]).toMatchObject({ trainingGroup: 'HOPE Elite', trainingLevel: 'Full Stack + AI', sourceRows: [2, 3] });
  });
  it('refuses inconsistent duplicate allocations and missing training groups', () => {
    expect(() => parseAllocations([header, row, [2, ...row.slice(1, 5), 'AIML', 'Level 1']])).toThrow('Conflicting duplicate allocation');
    expect(() => parseAllocations([header, [...row.slice(0, 5), null, 'Level 1']])).toThrow('Missing training allocation');
  });

  it('returns existing assignments independently of scores and new selection decisions', async () => {
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', studentId: '312325000001', registerNumber: '312325000001', name: 'Roster Student',
        batch: { batchIdentifier: 'SJCE-II-2026-2027-CSE', department: { name: 'CSE' } },
        rosterAllocation: { trainingGroup: 'HOPE Elite', trainingLevel: 'Full Stack + AI', sourceFile: 'roster.xlsx', sourceSheet: 'Sheet1', importedAt: new Date() } }) },
      studentCycleStatus: { findFirst: jest.fn().mockResolvedValue(null) }, assessmentResult: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const result = await new ProfilesService(prisma as any).mine({ role: 'STUDENT', studentId: 'student-1' } as AuthPrincipal);
    expect(result.rosterAllocation).toMatchObject({ trainingGroup: 'HOPE Elite', trainingLevel: 'Full Stack + AI' });
    expect(result.assessmentStatus).toBe('PENDING');
    expect(result.scoreBreakdown).toEqual([]);
    expect(result.classification).toBeUndefined();
    expect(result.allocation).toBeUndefined();
    expect(result.reason).toContain('no new eligibility, ranking or selection');
    expect(result.nextSteps[0]).toContain('HOPE Elite');
  });

  it('does not let students list other imported allocations or profiles', async () => {
    const service = new ProfilesService({} as any);
    await expect(service.rosterAllocations({ role: 'STUDENT' } as AuthPrincipal)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.mine({ role: 'STUDENT' } as AuthPrincipal)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('provides paginated read-only allocations for faculty with search and group filters', async () => {
    const prisma = { rosterAllocation: {
      count: jest.fn().mockResolvedValue(1), groupBy: jest.fn().mockResolvedValue([{ trainingGroup: 'HOPE Elite', _count: { _all: 74 } }]),
      findMany: jest.fn().mockResolvedValue([{ trainingGroup: 'HOPE Elite', trainingLevel: 'Full Stack + AI', sourceFile: 'roster.xlsx', importedAt: new Date(),
        student: { studentId: 's-1', registerNumber: '312325000001', name: 'Roster Student', batch: { batchIdentifier: 'SJCE-II-2026-2027-CSE', department: { name: 'CSE' } } } }]),
    } };
    const result = await new ProfilesService(prisma as any).rosterAllocations({ role: 'PEP_STAFF' } as AuthPrincipal, 'Roster', 2, 'HOPE Elite');
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 25, groups: [{ name: 'HOPE Elite', count: 74 }] });
    expect(prisma.rosterAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25, where: expect.objectContaining({ trainingGroup: 'HOPE Elite' }) }));
    expect(result.records[0].trainingLevel).toBe('Full Stack + AI');
  });
});
