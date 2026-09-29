import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WeightsService } from '../src/member1/weights/weights.service';
import { RankingService } from '../src/member1/ranking/ranking.service';
import { ScoringService } from '../src/member1/scoring/scoring.service';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

// ─── Constants ───────────────────────────────────────────────────────────────

const CYCLE_ID = 'cycle-001';
const WV1_ID = 'wv-001';
const WV2_ID = 'wv-002';
const ACTOR = 'admin-001';
const STUDENT_ID = 'student-001';

const SAMPLE_WEIGHTS = [
  {
    parameterKey: 'coding',
    parameterLabel: 'Coding Score',
    weight: 0.6,
    maxRawScore: 100,
    sortOrder: 1,
  },
  {
    parameterKey: 'aptitude',
    parameterLabel: 'Aptitude Score',
    weight: 0.4,
    maxRawScore: 100,
    sortOrder: 2,
  },
];

// ─── Shared mock factory ──────────────────────────────────────────────────────

function buildPrisma() {
  return {
    selectionCycle: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    cycleConfig: { findUnique: jest.fn(), update: jest.fn() },
    weightVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    studentCycleStatus: { findMany: jest.fn() },
    studentScore: { upsert: jest.fn(), findMany: jest.fn() },
    studentRanking: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    rankingSnapshot: { findFirst: jest.fn(), create: jest.fn() },
    rankingSnapshotEntry: { createMany: jest.fn() },
    freezeSchedule: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
}

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

// ─── Group 1: Weight version immutability on creation ────────────────────────

describe('WeightsService — weight version creation is immutable', () => {
  let service: WeightsService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findFirst.mockResolvedValue({ version: 2 });
    prisma.weightVersion.create.mockResolvedValue({ id: WV2_ID, version: 3 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(WeightsService);
  });

  it('creates new WeightVersion with monotonically incremented version number', async () => {
    const result = await service.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR);

    const createCall = prisma.weightVersion.create.mock.calls[0][0];
    expect(createCall.data.version).toBe(3);
    expect(result.version).toBe(3);
  });

  it('does not modify any existing WeightVersion record', async () => {
    await service.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR);

    expect(prisma.weightVersion.update).not.toHaveBeenCalled();
  });

  it('does not set CycleConfig.activeWeightVersionId', async () => {
    await service.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR);

    expect(prisma.cycleConfig.update).not.toHaveBeenCalled();
  });

  it('does not write to the StudentRanking table', async () => {
    await service.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR);

    expect(prisma.studentRanking.upsert).not.toHaveBeenCalled();
  });

  it('logs WEIGHT_VERSION_CREATED audit event', async () => {
    await service.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR, 'v3 weights');

    const logCall = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'WEIGHT_VERSION_CREATED',
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].entityType).toBe('WeightVersion');
    expect(logCall[0].newValue.version).toBe(3);
  });
});

// ─── Group 2: Activation updates only the active pointer ─────────────────────

describe('WeightsService — activation updates only the active pointer', () => {
  let service: WeightsService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      selectionCycleId: CYCLE_ID,
    });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV1_ID,
    });
    prisma.cycleConfig.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(WeightsService);
  });

  it('updates CycleConfig.activeWeightVersionId to the new version', async () => {
    await service.activate(CYCLE_ID, WV2_ID, ACTOR);

    expect(prisma.cycleConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { activeWeightVersionId: WV2_ID },
      }),
    );
  });

  it('does not call studentRanking.upsert (no auto-recalculation)', async () => {
    await service.activate(CYCLE_ID, WV2_ID, ACTOR);

    expect(prisma.studentRanking.upsert).not.toHaveBeenCalled();
  });

  it('does not call studentScore.upsert (no auto-recalculation)', async () => {
    await service.activate(CYCLE_ID, WV2_ID, ACTOR);

    expect(prisma.studentScore.upsert).not.toHaveBeenCalled();
  });

  it('logs WEIGHT_VERSION_ACTIVATED with both previousValue and newValue', async () => {
    await service.activate(CYCLE_ID, WV2_ID, ACTOR);

    const logCall = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'WEIGHT_VERSION_ACTIVATED',
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].previousValue).toEqual({
      activeWeightVersionId: WV1_ID,
    });
    expect(logCall[0].newValue).toEqual({
      activeWeightVersionId: WV2_ID,
    });
  });

  it('rejects if weight version belongs to a different selection cycle', async () => {
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV1_ID,
      selectionCycleId: 'different-cycle',
    });

    await expect(service.activate(CYCLE_ID, WV1_ID, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
  });
});

// ─── Group 3: Explicit recalculation respects the active weight version ───────

describe('RankingService — explicit recalculation respects active weight version', () => {
  let service: RankingService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(RankingService);
  });

  it('resolves the active weight version from CycleConfig when no weightVersionId is given', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV1_ID,
    });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV1_ID,
      version: 1,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([]);
    prisma.studentScore.findMany.mockResolvedValue([]);

    await service.calculate(CYCLE_ID, undefined, ACTOR);

    expect(prisma.cycleConfig.findUnique).toHaveBeenCalledWith({
      where: { selectionCycleId: CYCLE_ID },
    });
    expect(prisma.weightVersion.findUnique).toHaveBeenCalledWith({
      where: { id: WV1_ID },
    });
  });

  it('uses an explicitly provided weightVersionId and does not consult CycleConfig', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([]);
    prisma.studentScore.findMany.mockResolvedValue([]);

    await service.calculate(CYCLE_ID, WV2_ID, ACTOR);

    expect(prisma.cycleConfig.findUnique).not.toHaveBeenCalled();
  });

  it('writes StudentRanking records keyed to the resolved weightVersionId', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([
      { studentId: STUDENT_ID },
    ]);
    prisma.studentScore.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, parameterKey: 'coding', weightedScore: 80 },
    ]);
    prisma.studentRanking.upsert.mockResolvedValue({});

    await service.calculate(CYCLE_ID, WV2_ID, ACTOR);

    const upsertCall = prisma.studentRanking.upsert.mock.calls[0][0];
    expect(upsertCall.create.weightVersionId).toBe(WV2_ID);
    expect(upsertCall.update.weightVersionId).toBe(WV2_ID);
  });

  it('RANKING_CALCULATION_STARTED audit log includes the resolved weightVersionId', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV1_ID,
    });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV1_ID,
      version: 1,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([]);
    prisma.studentScore.findMany.mockResolvedValue([]);

    await service.calculate(CYCLE_ID, undefined, ACTOR);

    const startedLog = mockAudit.log.mock.calls.find(
      (c) => c[0].action === 'RANKING_CALCULATION_STARTED',
    );
    expect(startedLog).toBeDefined();
    expect(startedLog[0].metadata.weightVersionId).toBe(WV1_ID);
  });
});

// ─── Group 4: Scoring records are keyed by weightVersionId ───────────────────

describe('ScoringService — scoring records are keyed by weightVersionId', () => {
  let service: ScoringService;
  let prisma: ReturnType<typeof buildPrisma>;

  const PARAM_SCORES = [
    { parameterKey: 'coding', rawScore: 80 },
    { parameterKey: 'aptitude', rawScore: 70 },
  ];

  function setupValidScoringContext(wvId: string) {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.student.findUnique.mockResolvedValue({ id: STUDENT_ID });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: wvId,
    });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: wvId,
      version: wvId === WV1_ID ? 1 : 2,
      selectionCycleId: CYCLE_ID,
      weights: [
        {
          parameterKey: 'coding',
          parameterLabel: 'Coding',
          weight: 0.6,
          maxRawScore: 100,
          sortOrder: 1,
        },
        {
          parameterKey: 'aptitude',
          parameterLabel: 'Aptitude',
          weight: 0.4,
          maxRawScore: 100,
          sortOrder: 2,
        },
      ],
    });
    prisma.studentScore.upsert.mockResolvedValue({});
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(ScoringService);
  });

  it('stores StudentScore records with the active weightVersionId at the time of the call', async () => {
    setupValidScoringContext(WV1_ID);

    await service.calculateStudentScores(
      CYCLE_ID,
      STUDENT_ID,
      PARAM_SCORES,
      ACTOR,
    );

    const upsertCall = prisma.studentScore.upsert.mock.calls[0][0];
    expect(upsertCall.create.weightVersionId).toBe(WV1_ID);
  });

  it('loadActiveWeights returns the version currently pointed to by CycleConfig', async () => {
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV2_ID,
    });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
      weights: [
        {
          parameterKey: 'coding',
          weight: 0.7,
          maxRawScore: 100,
          sortOrder: 1,
        },
      ],
    });

    const result = await service.loadActiveWeights(CYCLE_ID);

    expect(result.weightVersion.id).toBe(WV2_ID);
    expect(result.weightVersion.version).toBe(2);
  });

  it('getStudentScores filters by weightVersionId, excluding scores from other versions', async () => {
    prisma.studentScore.findMany.mockResolvedValue([
      {
        studentId: STUDENT_ID,
        selectionCycleId: CYCLE_ID,
        weightVersionId: WV2_ID,
        parameterKey: 'coding',
        rawScore: 90,
        isMissing: false,
        normalizedScore: 90,
        weight: 0.6,
        weightedScore: 54,
      },
    ]);

    const result = await service.getStudentScores(STUDENT_ID, CYCLE_ID, WV2_ID);

    expect(result).not.toBeNull();
    expect(result!.weightVersionId).toBe(WV2_ID);
    expect(
      prisma.studentScore.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ weightVersionId: WV2_ID }),
      }),
    );
  });
});

// ─── Group 5: Frozen snapshots unaffected by weight lifecycle changes ─────────

describe('weight lifecycle — frozen snapshots are unaffected', () => {
  let weightsService: WeightsService;
  let classificationService: ClassificationService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findFirst.mockResolvedValue({ version: 1 });
    prisma.weightVersion.create.mockResolvedValue({ id: WV2_ID, version: 2 });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      selectionCycleId: CYCLE_ID,
    });
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV1_ID,
    });
    prisma.cycleConfig.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeightsService,
        ClassificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    weightsService = module.get(WeightsService);
    classificationService = module.get(ClassificationService);
  });

  it('createVersion does not interact with the rankingSnapshot table', async () => {
    await weightsService.createVersion(CYCLE_ID, SAMPLE_WEIGHTS, ACTOR);

    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('activate does not interact with rankingSnapshot or rankingSnapshotEntry tables', async () => {
    await weightsService.activate(CYCLE_ID, WV2_ID, ACTOR);

    expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
  });

  it('resolveSelectionAuthority returns SNAPSHOT source regardless of which weight version is active', async () => {
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

    // Simulate weight version change: active version is now WV2
    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WV2_ID,
    });

    const authority =
      await classificationService.resolveSelectionAuthority(CYCLE_ID);

    // Authority resolves from FreezeSchedule, not from CycleConfig/WeightVersion
    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotId).toBe('snap-001');
    // CycleConfig was never consulted by resolveSelectionAuthority
    expect(prisma.cycleConfig.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Group 6: Re-freeze after recalculation captures updated ranking ──────────

describe('RankingService — recalculated rankings are available to FreezeService via findMany', () => {
  let service: RankingService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();

    prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(RankingService);
  });

  it('explicit recalculation writes StudentRanking records carrying the new weightVersionId', async () => {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([
      { studentId: 'student-001' },
      { studentId: 'student-002' },
    ]);
    prisma.studentScore.findMany.mockResolvedValue([
      { studentId: 'student-001', parameterKey: 'coding', weightedScore: 85 },
      { studentId: 'student-002', parameterKey: 'coding', weightedScore: 70 },
    ]);
    prisma.studentRanking.upsert.mockResolvedValue({});

    await service.calculate(CYCLE_ID, WV2_ID, ACTOR);

    // Every upserted ranking record carries the new weightVersionId
    for (const call of prisma.studentRanking.upsert.mock.calls) {
      expect(call[0].create.weightVersionId).toBe(WV2_ID);
      expect(call[0].update.weightVersionId).toBe(WV2_ID);
    }
    expect(prisma.studentRanking.upsert).toHaveBeenCalledTimes(2);
  });

  it('StudentRanking written by recalculation is the same data FreezeService reads via findMany', async () => {
    // Simulate stateful write: upsert updates in-memory store, findMany reads from it
    const store: Record<string, unknown> = {};

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: WV2_ID,
      version: 2,
      selectionCycleId: CYCLE_ID,
    });
    prisma.studentCycleStatus.findMany.mockResolvedValue([
      { studentId: STUDENT_ID },
    ]);
    prisma.studentScore.findMany.mockResolvedValue([
      { studentId: STUDENT_ID, parameterKey: 'coding', weightedScore: 90 },
    ]);
    prisma.studentRanking.upsert.mockImplementation(async ({ create }) => {
      store[create.studentId] = create;
      return create;
    });
    prisma.studentRanking.findMany.mockImplementation(async () =>
      Object.values(store),
    );

    // Step 1: explicit recalculation with WV2
    await service.calculate(CYCLE_ID, WV2_ID, ACTOR);

    // Step 2: FreezeService reads studentRanking.findMany — the same table updated by calculate()
    const rankings = await prisma.studentRanking.findMany({
      where: { selectionCycleId: CYCLE_ID },
      orderBy: { rank: 'asc' },
    });

    // The freeze will capture rankings that carry the WV2 weightVersionId
    expect(rankings).toHaveLength(1);
    expect((rankings[0] as { weightVersionId: string }).weightVersionId).toBe(WV2_ID);
  });
});
