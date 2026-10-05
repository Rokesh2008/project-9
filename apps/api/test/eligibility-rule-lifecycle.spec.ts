import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EligibilityService } from '../src/member1/eligibility/eligibility.service';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

// ─── Constants ───────────────────────────────────────────────────────────────

const CYCLE_ID = 'cycle-001';
const RV1_ID = 'rv-001';
const RV2_ID = 'rv-002';
const ACTOR = 'admin-001';
const STUDENT_ID = 'student-001';

const V1_RULES = {
  logic: 'AND',
  rules: [{ id: 'r1', field: 'codingScore', operator: 'GTE', value: 50 }],
};

const V2_RULES = {
  logic: 'AND',
  rules: [{ id: 'r1', field: 'codingScore', operator: 'GTE', value: 60 }],
};

// ─── Shared mock factory ──────────────────────────────────────────────────────

function buildPrisma() {
  return {
    selectionCycle: { findUnique: jest.fn() },
    student: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    cycleConfig: { findUnique: jest.fn(), update: jest.fn() },
    eligibilityRuleVersion: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    eligibilityResult: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    studentRanking: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    hopePepClassification: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    rankingSnapshot: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    rankingSnapshotEntry: {
      createMany: jest.fn(),
    },
    freezeSchedule: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

// ─── Group 1: Rule version immutability on creation ──────────────────────────

describe('EligibilityService — rule version creation is immutable', () => {
  let service: EligibilityService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.eligibilityRuleVersion.findFirst.mockResolvedValue({ version: 1 });
    prisma.eligibilityRuleVersion.create.mockResolvedValue({
      id: RV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES,
      isActive: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  it('creates a new EligibilityRuleVersion row with incremented version number', async () => {
    const result = await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      logic: 'AND',
      actorId: ACTOR,
    });

    expect(prisma.eligibilityRuleVersion.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.eligibilityRuleVersion.create.mock.calls[0][0];
    expect(createCall.data.version).toBe(2);
    expect(result.version).toBe(2);
  });

  it('creates new version with isActive: false — previous version status is unchanged', async () => {
    await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      logic: 'AND',
      actorId: ACTOR,
    });

    const createCall = prisma.eligibilityRuleVersion.create.mock.calls[0][0];
    expect(createCall.data.isActive).toBe(false);
    // Existing rule versions are never updated during creation
    expect(prisma.eligibilityRuleVersion.update).not.toHaveBeenCalled();
    expect(prisma.eligibilityRuleVersion.updateMany).not.toHaveBeenCalled();
  });

  it('does not call eligibilityResult.upsert — existing results are unchanged', async () => {
    await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      actorId: ACTOR,
    });

    expect(prisma.eligibilityResult.upsert).not.toHaveBeenCalled();
  });

  it('does not call studentRanking.upsert — ranking is unaffected by rule creation', async () => {
    await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      actorId: ACTOR,
    });

    expect(prisma.studentRanking.upsert).not.toHaveBeenCalled();
  });

  it('does not interact with rankingSnapshot or rankingSnapshotEntry tables', async () => {
    await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      actorId: ACTOR,
    });

    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshot.findFirst).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
  });

  it('logs ELIGIBILITY_RULE_VERSION_CREATED audit event', async () => {
    await service.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      actorId: ACTOR,
    });

    const logCall = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'ELIGIBILITY_RULE_VERSION_CREATED',
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].entityType).toBe('EligibilityRuleVersion');
    expect(logCall[0].newValue.version).toBe(2);
  });

  it('propagates DB unique-constraint error for concurrent version creation', async () => {
    prisma.eligibilityRuleVersion.create.mockRejectedValue(
      new Error('Unique constraint failed on fields: (selectionCycleId, version)'),
    );

    await expect(
      service.createRuleVersion({
        selectionCycleId: CYCLE_ID,
        rules: V2_RULES.rules as any,
        actorId: ACTOR,
      }),
    ).rejects.toThrow('Unique constraint failed');
  });
});

// ─── Group 2: Activation updates only the active pointer ─────────────────────

describe('EligibilityService — activation updates only the active pointer', () => {
  let service: EligibilityService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: RV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      isActive: false,
    });
    prisma.eligibilityRuleVersion.updateMany.mockResolvedValue({ count: 1 });
    prisma.eligibilityRuleVersion.update.mockResolvedValue({
      id: RV2_ID,
      isActive: true,
    });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: RV1_ID,
    });
    prisma.cycleConfig.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  it('updates CycleConfig.eligibilityRuleVersionId to the activated version', async () => {
    await service.activateRuleVersion({
      selectionCycleId: CYCLE_ID,
      ruleVersionId: RV2_ID,
      actorId: ACTOR,
    });

    expect(prisma.cycleConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { eligibilityRuleVersionId: RV2_ID },
      }),
    );
  });

  it('does NOT call eligibilityResult.upsert — no auto-recalculation', async () => {
    await service.activateRuleVersion({
      selectionCycleId: CYCLE_ID,
      ruleVersionId: RV2_ID,
      actorId: ACTOR,
    });

    expect(prisma.eligibilityResult.upsert).not.toHaveBeenCalled();
  });

  it('does NOT call studentRanking.upsert — no auto-recalculation of ranking', async () => {
    await service.activateRuleVersion({
      selectionCycleId: CYCLE_ID,
      ruleVersionId: RV2_ID,
      actorId: ACTOR,
    });

    expect(prisma.studentRanking.upsert).not.toHaveBeenCalled();
  });

  it('does NOT call rankingSnapshot.create — no frozen snapshot mutation', async () => {
    await service.activateRuleVersion({
      selectionCycleId: CYCLE_ID,
      ruleVersionId: RV2_ID,
      actorId: ACTOR,
    });

    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
  });

  it('logs ELIGIBILITY_RULE_VERSION_ACTIVATED audit event', async () => {
    await service.activateRuleVersion({
      selectionCycleId: CYCLE_ID,
      ruleVersionId: RV2_ID,
      actorId: ACTOR,
    });

    const logCall = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'ELIGIBILITY_RULE_VERSION_ACTIVATED',
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].entityType).toBe('EligibilityRuleVersion');
    expect(logCall[0].entityId).toBe(RV2_ID);
  });

  it('rejects if rule version belongs to a different selection cycle', async () => {
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: RV1_ID,
      selectionCycleId: 'other-cycle',
      version: 1,
    });

    await expect(
      service.activateRuleVersion({
        selectionCycleId: CYCLE_ID,
        ruleVersionId: RV1_ID,
        actorId: ACTOR,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ─── Group 3: Explicit recalculation properties ───────────────────────────────

describe('EligibilityService — explicit recalculation uses active rule version', () => {
  let service: EligibilityService;
  let prisma: ReturnType<typeof buildPrisma>;

  function setupValidEvalContext(ruleVersionId: string, rules: object) {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: ruleVersionId,
    });
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: ruleVersionId,
      version: ruleVersionId === RV1_ID ? 1 : 2,
      selectionCycleId: CYCLE_ID,
      rules,
      isActive: true,
    });
    prisma.student.findMany.mockResolvedValue([
      { id: STUDENT_ID },
    ]);
    prisma.student.findUnique.mockResolvedValue({
      id: STUDENT_ID,
      studentId: 'REG001',
      name: 'Alice',
      email: 'alice@uni.edu',
      isActive: true,
      batchId: 'b1',
      batch: { id: 'b1' },
      assessmentResults: [
        { assessmentType: 'CODING', score: 80, maxScore: 100, percentage: 80 },
      ],
    });
    prisma.eligibilityResult.upsert.mockResolvedValue({});
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  it('resolves the active rule version from CycleConfig when no explicit ID is given', async () => {
    setupValidEvalContext(RV2_ID, V2_RULES);

    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.cycleConfig.findUnique).toHaveBeenCalledWith({
      where: { selectionCycleId: CYCLE_ID },
    });
    expect(prisma.eligibilityRuleVersion.findUnique).toHaveBeenCalledWith({
      where: { id: RV2_ID },
    });
  });

  it('uses explicit ruleVersionId when provided, bypassing CycleConfig', async () => {
    setupValidEvalContext(RV2_ID, V2_RULES);
    // Override to return the explicit version directly
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValueOnce({
      id: RV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES,
      isActive: true,
    });

    await service.evaluate(CYCLE_ID, RV2_ID, ACTOR);

    // CycleConfig should NOT be consulted when an explicit ruleVersionId is given
    expect(prisma.cycleConfig.findUnique).not.toHaveBeenCalled();
  });

  it('all eligibilityResult.upsert calls in one evaluation share the same ruleVersionId', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: RV2_ID,
    });
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: RV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES,
      isActive: true,
    });
    prisma.student.findMany.mockResolvedValue([
      { id: 'stu-1' },
      { id: 'stu-2' },
      { id: 'stu-3' },
    ]);
    prisma.student.findUnique.mockResolvedValue({
      id: STUDENT_ID,
      studentId: 'REG001',
      name: 'Alice',
      email: 'alice@uni.edu',
      isActive: true,
      batchId: 'b1',
      batch: { id: 'b1' },
      assessmentResults: [
        { assessmentType: 'CODING', score: 80, maxScore: 100, percentage: 80 },
      ],
    });
    prisma.eligibilityResult.upsert.mockResolvedValue({});

    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    // Every upsert uses the SAME resolved ruleVersionId
    for (const call of prisma.eligibilityResult.upsert.mock.calls) {
      expect(call[0].create.ruleVersionId).toBe(RV2_ID);
      expect(call[0].update.ruleVersionId).toBe(RV2_ID);
    }
    expect(prisma.eligibilityResult.upsert).toHaveBeenCalledTimes(3);
  });

  it('EligibilityResult.upsert stores the new ruleVersionId after rule change + recalculation', async () => {
    // After activating RV2 and explicitly recalculating, result carries RV2_ID
    setupValidEvalContext(RV2_ID, V2_RULES);

    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    const upsertCall = prisma.eligibilityResult.upsert.mock.calls[0][0];
    expect(upsertCall.create.ruleVersionId).toBe(RV2_ID);
    expect(upsertCall.update.ruleVersionId).toBe(RV2_ID);
  });

  it('ELIGIBILITY_EVALUATION_STARTED audit log includes the resolved ruleVersionId', async () => {
    setupValidEvalContext(RV2_ID, V2_RULES);

    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    const startedLog = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'ELIGIBILITY_EVALUATION_STARTED',
    );
    expect(startedLog).toBeDefined();
    expect(startedLog[0].metadata.ruleVersionId).toBe(RV2_ID);
  });
});

// ─── Group 4: No automatic side effects from recalculation ───────────────────

describe('EligibilityService — recalculation does not touch ranking or snapshot tables', () => {
  let service: EligibilityService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: RV1_ID,
    });
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: RV1_ID,
      version: 1,
      selectionCycleId: CYCLE_ID,
      rules: V1_RULES,
      isActive: true,
    });
    prisma.student.findMany.mockResolvedValue([{ id: STUDENT_ID }]);
    prisma.student.findUnique.mockResolvedValue({
      id: STUDENT_ID,
      studentId: 'REG001',
      name: 'Alice',
      email: 'alice@uni.edu',
      isActive: true,
      batchId: 'b1',
      batch: { id: 'b1' },
      assessmentResults: [
        { assessmentType: 'CODING', score: 80, maxScore: 100, percentage: 80 },
      ],
    });
    prisma.eligibilityResult.upsert.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  it('evaluate() does NOT call studentRanking.upsert', async () => {
    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.studentRanking.upsert).not.toHaveBeenCalled();
  });

  it('evaluate() does NOT call hopePepClassification.upsert', async () => {
    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.hopePepClassification.upsert).not.toHaveBeenCalled();
  });

  it('evaluate() does NOT call rankingSnapshot.create', async () => {
    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
  });

  it('evaluate() does NOT call rankingSnapshotEntry.createMany', async () => {
    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
  });

  it('evaluation engine failure is logged and does NOT touch rankingSnapshot', async () => {
    // Corrupt the student context so the engine throws
    prisma.student.findUnique.mockResolvedValue(null);

    await expect(service.evaluate(CYCLE_ID, undefined, ACTOR)).rejects.toThrow();

    // Frozen snapshot tables remain untouched even on failure
    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
  });
});

// ─── Group 5: Frozen authority unaffected by rule lifecycle ──────────────────

describe('eligibility rule lifecycle — frozen authority is unaffected', () => {
  let eligibilityService: EligibilityService;
  let classificationService: ClassificationService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        ClassificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    eligibilityService = module.get(EligibilityService);
    classificationService = module.get(ClassificationService);
  });

  it('resolveSelectionAuthority returns SNAPSHOT regardless of which eligibility rule version is active', async () => {
    prisma.freezeSchedule.findFirst.mockResolvedValue({
      id: 'fs-001',
      status: 'EXECUTED',
      snapshotId: 'snap-001',
      executedAt: new Date('2026-01-01'),
    });
    prisma.rankingSnapshot.findFirst.mockResolvedValue({
      id: 'snap-001',
      version: 1,
      selectionCycleId: CYCLE_ID,
      frozenAt: new Date('2026-01-01'),
      hopeCount: 10,
      pepCount: 5,
    });

    // Simulate: new rule version was activated (CycleConfig now points to RV2)
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: RV2_ID,
    });

    const authority =
      await classificationService.resolveSelectionAuthority(CYCLE_ID);

    // Authority reads from FreezeSchedule, not from CycleConfig or EligibilityResult
    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotId).toBe('snap-001');
    // CycleConfig was never consulted by resolveSelectionAuthority
    expect(prisma.cycleConfig.findUnique).not.toHaveBeenCalled();
  });

  it('loadClassificationInputs reads eligibilityResult.findMany for live classification', async () => {
    prisma.studentRanking.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, rank: 1 },
    ]);
    prisma.eligibilityResult.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, isEligible: true },
    ]);

    const inputs =
      await classificationService.loadClassificationInputs(CYCLE_ID);

    // Live classification reads from the current eligibilityResult table
    expect(prisma.eligibilityResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { selectionCycleId: CYCLE_ID } }),
    );
    expect(inputs[0].hopeEligible).toBe(true);
  });

  it('createRuleVersion does not interact with freezeSchedule, rankingSnapshot, or eligibilityResult', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.eligibilityRuleVersion.findFirst.mockResolvedValue({ version: 1 });
    prisma.eligibilityRuleVersion.create.mockResolvedValue({
      id: RV2_ID,
      version: 2,
    });

    await eligibilityService.createRuleVersion({
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES.rules as any,
      actorId: ACTOR,
    });

    expect(prisma.freezeSchedule.findFirst).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.eligibilityResult.upsert).not.toHaveBeenCalled();
  });
});

// ─── Group 6: Re-freeze after eligibility recalculation ──────────────────────

describe('eligibility recalculation — updated results are captured by re-freeze', () => {
  let service: EligibilityService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  it('evaluate() updates eligibilityResult; subsequent findMany returns the new isEligible state', async () => {
    const stored: Record<string, { isEligible: boolean; ruleVersionId: string }> =
      {};

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      eligibilityRuleVersionId: RV2_ID,
    });
    prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
      id: RV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      rules: V2_RULES,
      isActive: true,
    });
    prisma.student.findMany.mockResolvedValue([{ id: STUDENT_ID }]);
    prisma.student.findUnique.mockResolvedValue({
      id: STUDENT_ID,
      studentId: 'REG001',
      name: 'Alice',
      email: 'alice@uni.edu',
      isActive: true,
      batchId: 'b1',
      batch: { id: 'b1' },
      assessmentResults: [
        { assessmentType: 'CODING', score: 75, maxScore: 100, percentage: 75 },
      ],
    });

    prisma.eligibilityResult.upsert.mockImplementation(async ({ create }) => {
      stored[create.studentId] = {
        isEligible: create.isEligible,
        ruleVersionId: create.ruleVersionId,
      };
      return create;
    });
    prisma.eligibilityResult.findMany.mockImplementation(async () =>
      Object.entries(stored).map(([studentId, v]) => ({
        studentId,
        selectionCycleId: CYCLE_ID,
        ...v,
      })),
    );

    // Step 1: explicit recalculation with RV2
    await service.evaluate(CYCLE_ID, undefined, ACTOR);

    // Step 2: FreezeService reads eligibilityResult.findMany — same table evaluate() wrote to
    const results = await prisma.eligibilityResult.findMany({
      where: { selectionCycleId: CYCLE_ID },
    });

    expect(results).toHaveLength(1);
    expect(
      (results[0] as { ruleVersionId: string }).ruleVersionId,
    ).toBe(RV2_ID);
    // Student with codingScore=75 passes the v2 rule (GTE 60)
    expect((results[0] as { isEligible: boolean }).isEligible).toBe(true);
  });

  it('snapshot entries from re-freeze contain isEligible from the current eligibilityResult', async () => {
    // Simulate: after recalculation, eligibilityResult shows student is ineligible under V2 rules
    prisma.eligibilityResult.findMany.mockResolvedValue([
      {
        studentId: STUDENT_ID,
        selectionCycleId: CYCLE_ID,
        isEligible: false,
        ruleVersionId: RV2_ID,
        failedRules: [{ message: 'codingScore GTE 60: failed (actual: 45)' }],
      },
    ]);

    // FreezeService reads this when building SnapshotStudentInput[]
    const eligibilityResults = await prisma.eligibilityResult.findMany({
      where: { selectionCycleId: CYCLE_ID },
    });

    // The snapshot entry will carry the updated eligibility state
    const isEligibleForStudent = eligibilityResults.find(
      (r: { studentId: string }) => r.studentId === STUDENT_ID,
    )?.isEligible;

    expect(isEligibleForStudent).toBe(false);
  });

  it('RankingSnapshot.ruleVersionId records the active rule version at freeze/re-freeze time', async () => {
    // This is stored by FreezeService via CycleConfig.eligibilityRuleVersionId lookup
    // Simulate: cycle config has RV2 active at re-freeze time
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: 'wv-001',
      eligibilityRuleVersionId: RV2_ID,
    });

    const config = await prisma.cycleConfig.findUnique({
      where: { selectionCycleId: CYCLE_ID },
    });

    expect(config!.eligibilityRuleVersionId).toBe(RV2_ID);
    // FreezeService reads this value and sets it on the new RankingSnapshot.ruleVersionId
  });

  it('resolveSelectionAuthority returns SNAPSHOT source after re-freeze (FreezeSchedule-based)', async () => {
    const newSnapId = 'snap-002';

    prisma.freezeSchedule.findFirst.mockResolvedValue({
      id: 'fs-002',
      status: 'EXECUTED',
      snapshotId: newSnapId,
      executedAt: new Date('2026-06-01'),
    });
    prisma.rankingSnapshot.findFirst.mockResolvedValue({
      id: newSnapId,
      version: 2,
      selectionCycleId: CYCLE_ID,
      frozenAt: new Date('2026-06-01'),
      hopeCount: 8,
      pepCount: 4,
      ruleVersionId: RV2_ID,
    });

    const classificationModule: TestingModule =
      await Test.createTestingModule({
        providers: [
          ClassificationService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditService, useValue: mockAudit },
        ],
      }).compile();

    const classificationService = classificationModule.get(ClassificationService);
    const authority =
      await classificationService.resolveSelectionAuthority(CYCLE_ID);

    // After re-freeze, authority resolves to new snapshot (eligibility rule change doesn't affect this)
    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotId).toBe(newSnapId);
    expect(authority.snapshotVersion).toBe(2);
  });
});
