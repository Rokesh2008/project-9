import { PrismaClient } from '@prisma/client';

export const SELECTION_DEMO_CODE = 'LIVE-RULES-DEMO-20261009';
export const SELECTION_DEMO_PREFIX = 'RULEDEMO-';

// Additive, repeatable setup: never reset existing results or touch real records.
export async function createSelectionDemo(db: PrismaClient) {
  const existing = await db.selectionCycle.findUnique({ where: { code: SELECTION_DEMO_CODE } });
  if (existing) return existing;
  return db.$transaction(async tx => {
    const department = await tx.department.create({ data: { code: SELECTION_DEMO_CODE, name: 'Synthetic Demonstration Department' } });
    const batch = await tx.batch.create({ data: { batchIdentifier: SELECTION_DEMO_CODE, academicYear: 'DEMO', departmentId: department.id } });
    const cycle = await tx.selectionCycle.create({ data: { code: SELECTION_DEMO_CODE, name: 'Live Rules Demo — Synthetic Students Only', academicPeriod: 'DEMO', startDate: new Date('2026-10-09'), endDate: new Date('2027-10-09'), status: 'DRAFT' } });
    const baseline = await tx.eligibilityRuleVersion.create({ data: { selectionCycleId: cycle.id, version: 1, isActive: true, createdBy: 'demo-setup', description: 'Demo baseline: coding ≥ 50 AND attendance ≥ 75%', rules: { logic: 'AND', rules: [{ id: 'demo-coding', field: 'codingScore', operator: 'GTE', value: 50 }, { id: 'demo-attendance', field: 'attendancePercent', operator: 'GTE', value: 75 }] } } });
    const weights = await tx.weightVersion.create({ data: { selectionCycleId: cycle.id, version: 1, createdBy: 'demo-setup', description: 'Demo: coding 60%, aptitude 40%', weights: { create: [{ parameterKey: 'coding', parameterLabel: 'Coding', weight: 0.6, maxRawScore: 100, sortOrder: 1 }, { parameterKey: 'aptitude', parameterLabel: 'Aptitude', weight: 0.4, maxRawScore: 100, sortOrder: 2 }] } } });
    await tx.cycleConfig.create({ data: { selectionCycleId: cycle.id, activeWeightVersionId: weights.id, eligibilityRuleVersionId: baseline.id, hopeCount: 2, pepCount: 2 } });
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
    for (let i = 0; i < names.length; i++) {
      await tx.student.create({ data: { studentId: `${SELECTION_DEMO_PREFIX}${i + 1}`, registerNumber: `${SELECTION_DEMO_PREFIX}${i + 1}`, name: `Synthetic ${names[i]}`, batchId: batch.id, cgpa: 9 - i * 0.5, attendancePercent: i === 5 ? 65 : 95,
        assessmentResults: { create: [{ sourceIdentifier: 'synthetic-coding', assessmentType: 'CODING', score: 95 - i * 10, maxScore: 100, percentage: 95 - i * 10 }, { sourceIdentifier: 'synthetic-aptitude', assessmentType: 'APTITUDE', score: [90,85,80,70,60,50][i], maxScore: 100, percentage: [90,85,80,70,60,50][i] }] },
        cycleStatuses: { create: { selectionCycleId: cycle.id } },
      } });
    }
    return cycle;
  }, { timeout: 60000 });
}
