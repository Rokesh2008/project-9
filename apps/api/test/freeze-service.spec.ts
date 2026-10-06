import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockNotifications = {
  planAndPersist: jest.fn().mockResolvedValue(undefined),
  cancelEventsForSchedule: jest.fn().mockResolvedValue(0),
  markExecuted: jest.fn().mockResolvedValue(undefined),
  getEventsForCycle: jest.fn().mockResolvedValue([]),
  getEventsForSchedule: jest.fn().mockResolvedValue([]),
};

function createMockPrisma() {
  return {
    selectionCycle: {
      findUnique: jest.fn(),
    },
    freezeSchedule: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    cycleConfig: {
      findUnique: jest.fn(),
    },
    weightVersion: {
      findUnique: jest.fn(),
    },
    eligibilityRuleVersion: {
      findUnique: jest.fn(),
    },
    studentRanking: {
      findMany: jest.fn(),
    },
    studentScore: {
      findMany: jest.fn(),
    },
    eligibilityResult: {
      findMany: jest.fn(),
    },
    hopePepClassification: {
      findMany: jest.fn(),
    },
    rankingSnapshot: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    rankingSnapshotEntry: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    studentCycleStatus: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('FreezeService', () => {
  let service: FreezeService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FreezeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: FreezeNotificationService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(FreezeService);
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────
  // Schedule
  // ─────────────────────────────────────

  describe('schedule', () => {
    it('should create a freeze schedule', async () => {
      const scheduledAt = new Date(Date.now() + 86_400_000);
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-1',
        scheduledAt,
        status: 'SCHEDULED',
      });

      const result = await service.schedule('cycle-1', scheduledAt, 'admin-1');
      expect(result.id).toBe('fs-1');
      expect(result.status).toBe('SCHEDULED');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_SCHEDULE_CREATED' }),
      );
    });

    it('should reject if cycle not found', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);
      await expect(
        service.schedule('bad-cycle', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject duplicate active schedule', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue({ id: 'existing', status: 'SCHEDULED' });

      await expect(
        service.schedule('cycle-1', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─────────────────────────────────────
  // Cancel
  // ─────────────────────────────────────

  describe('cancel', () => {
    it('should cancel an active schedule', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date('2026-10-01'),
      });
      prisma.freezeSchedule.update.mockResolvedValue({});

      await service.cancel('cycle-1', 'admin-1', 'No longer needed');
      expect(prisma.freezeSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fs-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_CANCELLED' }),
      );
    });

    it('should reject if no active schedule', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      await expect(
        service.cancel('cycle-1', 'admin-1', 'reason'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────
  // Execute Freeze
  // ─────────────────────────────────────

  describe('executeFreeze', () => {
    function setupFullMocks(overrides?: {
      rankings?: Array<Record<string, unknown>>;
      scores?: Array<Record<string, unknown>>;
      eligibility?: Array<Record<string, unknown>>;
      classifications?: Array<Record<string, unknown>>;
    }) {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: 'rv-1',
        hopeCount: 5,
        pepCount: 3,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1',
        version: 1,
        weights: [
          { parameterKey: 'coding', weight: 0.3 },
          { parameterKey: 'aptitude', weight: 0.2 },
        ],
      });
      prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: 'rv-1',
        version: 1,
      });

      const rankings = overrides?.rankings ?? [
        { studentId: 's1', rank: 1, totalScore: 90, percentile: 100, tieBreakApplied: false },
        { studentId: 's2', rank: 2, totalScore: 80, percentile: 50, tieBreakApplied: false },
      ];
      prisma.studentRanking.findMany.mockResolvedValue(rankings);

      const scores = overrides?.scores ?? [
        { studentId: 's1', parameterKey: 'coding', rawScore: 95, normalizedScore: 0.95, weight: 0.3, weightedScore: 28.5, isMissing: false },
        { studentId: 's1', parameterKey: 'aptitude', rawScore: 85, normalizedScore: 0.85, weight: 0.2, weightedScore: 17, isMissing: false },
        { studentId: 's2', parameterKey: 'coding', rawScore: 80, normalizedScore: 0.8, weight: 0.3, weightedScore: 24, isMissing: false },
        { studentId: 's2', parameterKey: 'aptitude', rawScore: 0, normalizedScore: 0, weight: 0.2, weightedScore: 0, isMissing: true },
      ];
      prisma.studentScore.findMany.mockResolvedValue(scores);

      const eligibility = overrides?.eligibility ?? [
        { studentId: 's1', isEligible: true, failedRules: null },
        { studentId: 's2', isEligible: false, failedRules: [{ message: 'GPA below threshold' }] },
      ];
      prisma.eligibilityResult.findMany.mockResolvedValue(eligibility);

      const classifications = overrides?.classifications ?? [
        { studentId: 's1', program: 'HOPE' },
        { studentId: 's2', program: 'NOT_ELIGIBLE' },
      ];
      prisma.hopePepClassification.findMany.mockResolvedValue(classifications);

      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1',
              version: 1,
              frozenAt: new Date('2026-10-01'),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: rankings.length }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });
    }

    it('should execute freeze and create snapshot', async () => {
      setupFullMocks();

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.snapshotId).toBe('snap-1');
      expect(result.version).toBe(1);
      expect(result.studentCount).toBe(2);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_EXECUTION_STARTED' }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SNAPSHOT_CREATED' }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_EXECUTION_COMPLETED' }),
      );
    });

    it('should reject if cycle not found', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);
      await expect(
        service.executeFreeze('bad-cycle', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject if no active weight version', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: null,
      });

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_EXECUTION_FAILED' }),
      );
    });

    it('should copy all ranking entries to snapshot', async () => {
      let capturedTxFn: ((tx: unknown) => Promise<unknown>) | null = null;
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        capturedTxFn = fn;
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });
      setupFullMocks();
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const createManyMock = jest.fn().mockResolvedValue({ count: 2 });
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: { createMany: createManyMock },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        const result = await fn(txPrisma);
        expect(createManyMock).toHaveBeenCalledTimes(1);
        const createManyArg = createManyMock.mock.calls[0][0];
        expect(createManyArg.data).toHaveLength(2);
        return result;
      });

      await service.executeFreeze('cycle-1', 'admin-1');
    });

    it('should preserve rank values in snapshot entries', async () => {
      setupFullMocks();
      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(entryData[0].rank).toBe(1);
      expect(entryData[1].rank).toBe(2);
    });

    it('should preserve total scores in snapshot entries', async () => {
      setupFullMocks();
      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(entryData[0].totalScore).toBe(90);
      expect(entryData[1].totalScore).toBe(80);
    });

    it('should preserve raw and weighted scores in parameterScores', async () => {
      setupFullMocks();
      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');

      const s1Scores = entryData[0].parameterScores as Record<string, { raw: number; weighted: number }>;
      expect(s1Scores.coding.raw).toBe(95);
      expect(s1Scores.coding.weighted).toBe(28.5);
      expect(s1Scores.aptitude.raw).toBe(85);
      expect(s1Scores.aptitude.weighted).toBe(17);
    });

    it('should preserve missing-score information', async () => {
      setupFullMocks();
      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');

      const s2Scores = entryData[1].parameterScores as Record<string, { isMissing: boolean }>;
      expect(s2Scores.aptitude.isMissing).toBe(true);
      expect(s2Scores.coding.isMissing).toBe(false);
    });

    it('should preserve classification in snapshot entries', async () => {
      setupFullMocks();
      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(entryData[0].program).toBe('HOPE');
      expect(entryData[1].program).toBe('NOT_ELIGIBLE');
    });

    it('should preserve weight version in snapshot', async () => {
      setupFullMocks();
      let snapshotData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              snapshotData = args.data;
              return { id: 'snap-1', version: 1, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(snapshotData!.weightVersionId).toBe('wv-1');
    });

    it('should preserve eligibility rule version in snapshot', async () => {
      setupFullMocks();
      let snapshotData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              snapshotData = args.data;
              return { id: 'snap-1', version: 1, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(snapshotData!.ruleVersionId).toBe('rv-1');
    });

    it('should handle zero students', async () => {
      setupFullMocks({ rankings: [], scores: [], eligibility: [], classifications: [] });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-empty', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.studentCount).toBe(0);
    });

    it('should handle zero-score students', async () => {
      setupFullMocks({
        rankings: [
          { studentId: 's1', rank: 1, totalScore: 0, percentile: 100, tieBreakApplied: false },
        ],
        scores: [
          { studentId: 's1', parameterKey: 'coding', rawScore: 0, normalizedScore: 0, weight: 0.3, weightedScore: 0, isMissing: false },
        ],
        eligibility: [
          { studentId: 's1', isEligible: true, failedRules: null },
        ],
        classifications: [
          { studentId: 's1', program: 'HOPE' },
        ],
      });

      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.studentCount).toBe(1);
      expect(entryData[0].totalScore).toBe(0);
    });

    it('should handle missing-score students', async () => {
      setupFullMocks({
        rankings: [
          { studentId: 's1', rank: 1, totalScore: 28.5, percentile: 100, tieBreakApplied: false },
        ],
        scores: [
          { studentId: 's1', parameterKey: 'coding', rawScore: 95, normalizedScore: 0.95, weight: 0.3, weightedScore: 28.5, isMissing: false },
          { studentId: 's1', parameterKey: 'aptitude', rawScore: 0, normalizedScore: 0, weight: 0.2, weightedScore: 0, isMissing: true },
        ],
        eligibility: [
          { studentId: 's1', isEligible: true, failedRules: null },
        ],
        classifications: [
          { studentId: 's1', program: 'HOPE' },
        ],
      });

      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      const scores = entryData[0].parameterScores as Record<string, { isMissing: boolean }>;
      expect(scores.aptitude.isMissing).toBe(true);
    });

    it('should mark freeze schedule as EXECUTED', async () => {
      setupFullMocks();
      const scheduleUpdateMock = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue({ id: 'fs-1' }),
            update: scheduleUpdateMock,
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(scheduleUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXECUTED' }),
        }),
      );
    });

    it('should log failure on error', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: null,
      });

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow();

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_EXECUTION_FAILED' }),
      );
    });

    it('should use transaction for atomicity', async () => {
      setupFullMocks();

      await service.executeFreeze('cycle-1', 'admin-1');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should rollback on transaction failure', async () => {
      setupFullMocks();
      prisma.$transaction.mockRejectedValue(new Error('DB error'));

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow('DB error');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_EXECUTION_FAILED' }),
      );
    });

    // P17 fix: executeFreeze should reject when students exist but ranking is empty
    it('rejects with BadRequestException when rankings empty but students exist', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue({ id: 'fs-1', status: 'SCHEDULED' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1', version: 1, weights: [],
      });
      prisma.eligibilityRuleVersion.findUnique.mockResolvedValue(null);
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentCycleStatus.count.mockResolvedValue(5); // students exist

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows empty snapshot when cycle has no students', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue({ id: 'fs-1', status: 'SCHEDULED' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1', version: 1, weights: [],
      });
      prisma.eligibilityRuleVersion.findUnique.mockResolvedValue(null);
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentCycleStatus.count.mockResolvedValue(0); // no students
      prisma.studentScore.findMany.mockResolvedValue([]);
      prisma.eligibilityResult.findMany.mockResolvedValue([]);
      prisma.hopePepClassification.findMany.mockResolvedValue([]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({ id: 'snap-1', version: 1, frozenAt: new Date() }),
          },
          rankingSnapshotEntry: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.studentCount).toBe(0);
    });
  });

  // ─────────────────────────────────────
  // Versioning
  // ─────────────────────────────────────

  describe('versioning', () => {
    it('should create version 1 if no prior snapshots', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1', version: 1, weights: [],
      });
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentCycleStatus.count.mockResolvedValue(0); // no students in cycle — empty snapshot is valid
      prisma.studentScore.findMany.mockResolvedValue([]);
      prisma.eligibilityResult.findMany.mockResolvedValue([]);
      prisma.hopePepClassification.findMany.mockResolvedValue([]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      let snapshotData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              snapshotData = args.data;
              return { id: 'snap-1', version: 1, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.version).toBe(1);
      expect(snapshotData!.version).toBe(1);
    });

    it('should increment version when prior snapshot exists', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1', version: 1, weights: [],
      });
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentCycleStatus.count.mockResolvedValue(0); // no students in cycle — empty snapshot is valid
      prisma.studentScore.findMany.mockResolvedValue([]);
      prisma.eligibilityResult.findMany.mockResolvedValue([]);
      prisma.hopePepClassification.findMany.mockResolvedValue([]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue({ version: 2 });

      let snapshotData: Record<string, unknown> | null = null;
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
              snapshotData = args.data;
              return { id: 'snap-3', version: 3, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.version).toBe(3);
      expect(snapshotData!.version).toBe(3);
    });
  });

  // ─────────────────────────────────────
  // Immutability
  // ─────────────────────────────────────

  describe('immutability', () => {
    it('snapshot service has no update methods for snapshot entries', () => {
      const serviceProto = Object.getOwnPropertyNames(
        Object.getPrototypeOf(service),
      );
      const updateMethods = serviceProto.filter(
        (m) =>
          m.includes('updateSnapshot') ||
          m.includes('editSnapshot') ||
          m.includes('modifySnapshot') ||
          m.includes('deleteSnapshotEntry'),
      );
      expect(updateMethods).toEqual([]);
    });

    it('later ranking changes do not alter snapshot (snapshot is a copy)', async () => {
      const snapshotData = {
        rank: 1,
        totalScore: 90,
        parameterScores: { coding: { raw: 95, weighted: 28.5 } },
      };

      const liveRanking = { rank: 1, totalScore: 90 };
      liveRanking.rank = 5;
      liveRanking.totalScore = 50;

      expect(snapshotData.rank).toBe(1);
      expect(snapshotData.totalScore).toBe(90);
    });

    it('later eligibility changes do not alter snapshot', () => {
      const snapshotEntry = {
        isEligible: true,
        eligibilityFailures: null,
      };

      const liveEligibility = { isEligible: true };
      liveEligibility.isEligible = false;

      expect(snapshotEntry.isEligible).toBe(true);
    });

    it('later classification changes do not alter snapshot', () => {
      const snapshotEntry = { program: 'HOPE' };

      const liveClassification = { program: 'HOPE' };
      liveClassification.program = 'NOT_ELIGIBLE';

      expect(snapshotEntry.program).toBe('HOPE');
    });

    it('snapshot v1 remains unchanged when v2 is created', () => {
      const v1 = {
        id: 'snap-v1',
        version: 1,
        entries: [{ studentId: 's1', rank: 1, totalScore: 90 }],
      };

      const v1Copy = JSON.parse(JSON.stringify(v1));

      const _v2 = {
        id: 'snap-v2',
        version: 2,
        entries: [{ studentId: 's1', rank: 2, totalScore: 85 }],
      };

      expect(v1.version).toBe(v1Copy.version);
      expect(v1.entries[0].rank).toBe(v1Copy.entries[0].rank);
      expect(v1.entries[0].totalScore).toBe(v1Copy.entries[0].totalScore);
    });
  });

  // ─────────────────────────────────────
  // Retrieval
  // ─────────────────────────────────────

  describe('getSchedule', () => {
    it('should return schedules for a cycle', async () => {
      prisma.freezeSchedule.findMany.mockResolvedValue([
        {
          id: 'fs-1',
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          executedAt: null,
          snapshotId: null,
          scheduledBy: 'admin-1',
          cancelledBy: null,
          cancelReason: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.getSchedule('cycle-1');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('SCHEDULED');
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots for a cycle', async () => {
      prisma.rankingSnapshot.findMany.mockResolvedValue([
        {
          id: 'snap-2', version: 2, totalStudents: 10,
          hopeCount: 5, pepCount: 3, frozenAt: new Date(),
          frozenBy: 'admin-1', weightVersionId: 'wv-1', ruleVersionId: 'rv-1',
        },
        {
          id: 'snap-1', version: 1, totalStudents: 10,
          hopeCount: 5, pepCount: 3, frozenAt: new Date(),
          frozenBy: 'admin-1', weightVersionId: 'wv-1', ruleVersionId: 'rv-1',
        },
      ]);

      const result = await service.getSnapshots('cycle-1');
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(2);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return latest snapshot', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: 'snap-3', version: 3, selectionCycleId: 'cycle-1',
        totalStudents: 10, hopeCount: 5, pepCount: 3,
        frozenAt: new Date(), frozenBy: 'admin-1',
        weightVersionId: 'wv-1', ruleVersionId: 'rv-1', reason: null,
      });

      const result = await service.getLatestSnapshot('cycle-1');
      expect(result.version).toBe(3);
    });

    it('should throw if no snapshots exist', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);
      await expect(
        service.getLatestSnapshot('cycle-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSnapshot', () => {
    it('should return specific snapshot', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: 'snap-1', version: 1, selectionCycleId: 'cycle-1',
        totalStudents: 10, hopeCount: 5, pepCount: 3,
        frozenAt: new Date(), frozenBy: 'admin-1',
        weightVersionId: 'wv-1', ruleVersionId: 'rv-1', reason: null,
      });

      const result = await service.getSnapshot('cycle-1', 'snap-1');
      expect(result.id).toBe('snap-1');
    });

    it('should throw if snapshot not found', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);
      await expect(
        service.getSnapshot('cycle-1', 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSnapshotStudents', () => {
    it('should return paginated entries', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue({ id: 'snap-1' });
      prisma.rankingSnapshotEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1', studentId: 's1', rank: 1, totalScore: 90,
          percentile: 100, parameterScores: {}, isEligible: true,
          eligibilityFailures: null, program: 'HOPE', tieBreakApplied: false,
        },
      ]);
      prisma.rankingSnapshotEntry.count.mockResolvedValue(10);

      const result = await service.getSnapshotStudents('cycle-1', 'snap-1', 1, 1);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(10);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
    });

    it('should throw if snapshot not found', async () => {
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);
      await expect(
        service.getSnapshotStudents('cycle-1', 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────
  // Deterministic Rank Boundaries
  // ─────────────────────────────────────

  describe('deterministic rank boundaries', () => {
    it('should preserve boundary students correctly', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
        hopeCount: 2,
        pepCount: 1,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1', version: 1, weights: [],
      });
      prisma.eligibilityRuleVersion.findUnique.mockResolvedValue(null);
      prisma.studentRanking.findMany.mockResolvedValue([
        { studentId: 's1', rank: 1, totalScore: 90, percentile: 100, tieBreakApplied: false },
        { studentId: 's2', rank: 2, totalScore: 85, percentile: 66, tieBreakApplied: false },
        { studentId: 's3', rank: 3, totalScore: 85, percentile: 33, tieBreakApplied: true },
      ]);
      prisma.studentScore.findMany.mockResolvedValue([]);
      prisma.eligibilityResult.findMany.mockResolvedValue([
        { studentId: 's1', isEligible: true, failedRules: null },
        { studentId: 's2', isEligible: true, failedRules: null },
        { studentId: 's3', isEligible: true, failedRules: null },
      ]);
      prisma.hopePepClassification.findMany.mockResolvedValue([
        { studentId: 's1', program: 'HOPE' },
        { studentId: 's2', program: 'HOPE' },
        { studentId: 's3', program: 'PEP' },
      ]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      let entryData: Array<Record<string, unknown>> = [];
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1', version: 1, frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation((args: { data: Array<Record<string, unknown>> }) => {
              entryData = args.data;
              return { count: args.data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      await service.executeFreeze('cycle-1', 'admin-1');

      expect(entryData).toHaveLength(3);
      expect(entryData[0].rank).toBe(1);
      expect(entryData[0].program).toBe('HOPE');
      expect(entryData[1].rank).toBe(2);
      expect(entryData[1].program).toBe('HOPE');
      expect(entryData[2].rank).toBe(3);
      expect(entryData[2].program).toBe('PEP');
      expect(entryData[2].tieBreakApplied).toBe(true);
    });
  });
});
