import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
} from '@nestjs/common';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';
import {
  getFreezeCountdown,
  type FreezeCountdown,
} from '../src/member1/freeze/freeze.engine';

// ═══════════════════════════════════════
// COUNTDOWN PURE FUNCTION TESTS
// ═══════════════════════════════════════

describe('getFreezeCountdown', () => {
  it('should return DUE when currentTime equals scheduledAt', () => {
    const t = new Date('2026-10-15T12:00:00Z');
    const result = getFreezeCountdown(t, t);
    expect(result.status).toBe('DUE');
    expect(result.remainingMilliseconds).toBe(0);
  });

  it('should return DUE when currentTime is after scheduledAt', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00Z');
    const currentTime = new Date('2026-10-15T12:05:00Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.status).toBe('DUE');
    expect(result.remainingMilliseconds).toBe(0);
  });

  it('should return UPCOMING when currentTime is before scheduledAt', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00Z');
    const currentTime = new Date('2026-10-15T11:00:00Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.status).toBe('UPCOMING');
    expect(result.remainingMilliseconds).toBe(3600000);
  });

  it('should return exact remaining milliseconds', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00.000Z');
    const currentTime = new Date('2026-10-15T11:59:59.500Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.status).toBe('UPCOMING');
    expect(result.remainingMilliseconds).toBe(500);
  });

  it('should clamp remainingMilliseconds to 0 when overdue', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00Z');
    const currentTime = new Date('2026-10-16T12:00:00Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.remainingMilliseconds).toBe(0);
  });

  it('should preserve scheduledAt and currentTime in result', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00Z');
    const currentTime = new Date('2026-10-15T11:00:00Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.scheduledAt).toBe(scheduledAt);
    expect(result.currentTime).toBe(currentTime);
  });

  it('should be deterministic — same inputs always produce same output', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00Z');
    const currentTime = new Date('2026-10-15T11:30:00Z');
    const r1 = getFreezeCountdown(scheduledAt, currentTime);
    const r2 = getFreezeCountdown(scheduledAt, currentTime);
    expect(r1.status).toBe(r2.status);
    expect(r1.remainingMilliseconds).toBe(r2.remainingMilliseconds);
  });

  it('should return UPCOMING with 1ms remaining', () => {
    const scheduledAt = new Date('2026-10-15T12:00:00.001Z');
    const currentTime = new Date('2026-10-15T12:00:00.000Z');
    const result = getFreezeCountdown(scheduledAt, currentTime);
    expect(result.status).toBe('UPCOMING');
    expect(result.remainingMilliseconds).toBe(1);
  });
});

// ═══════════════════════════════════════
// PROCESS DUE FREEZES SERVICE TESTS
// ═══════════════════════════════════════

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
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(),
  };
}

function setupExecutionMocksFor(
  prisma: ReturnType<typeof createMockPrisma>,
  cycleId: string,
  snapshotId: string,
) {
  prisma.selectionCycle.findUnique.mockResolvedValue({ id: cycleId });
  prisma.cycleConfig.findUnique.mockResolvedValue({
    selectionCycleId: cycleId,
    activeWeightVersionId: 'wv-1',
    eligibilityRuleVersionId: null,
  });
  prisma.weightVersion.findUnique.mockResolvedValue({
    id: 'wv-1',
    version: 1,
    weights: [],
  });
  prisma.studentRanking.findMany.mockResolvedValue([]);
  prisma.studentScore.findMany.mockResolvedValue([]);
  prisma.eligibilityResult.findMany.mockResolvedValue([]);
  prisma.hopePepClassification.findMany.mockResolvedValue([]);
  prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const txPrisma = {
        rankingSnapshot: {
          create: jest.fn().mockResolvedValue({
            id: snapshotId,
            version: 1,
            frozenAt: new Date(),
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
    },
  );
}

describe('processDueFreezes', () => {
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

  it('should return empty results when no SCHEDULED freezes exist', async () => {
    prisma.freezeSchedule.findMany.mockResolvedValue([]);
    const result = await service.processDueFreezes(new Date());
    expect(result.dueCount).toBe(0);
    expect(result.executedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('should skip SCHEDULED freezes that are not yet due', async () => {
    const futureTime = new Date('2026-12-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'SCHEDULED', scheduledAt: futureTime },
    ]);

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.dueCount).toBe(0);
    expect(result.executedCount).toBe(0);
  });

  it('should execute a single due freeze', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'SCHEDULED', scheduledAt: pastTime },
    ]);

    setupExecutionMocksFor(prisma, 'c1', 'snap-1');
    prisma.freezeSchedule.findFirst
      .mockResolvedValueOnce({ id: 'fs-1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(null);

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.dueCount).toBe(1);
    expect(result.executedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].snapshotId).toBe('snap-1');
  });

  it('should isolate failure — one failed freeze does not block others', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-bad', selectionCycleId: 'c-bad', status: 'SCHEDULED', scheduledAt: pastTime },
      { id: 'fs-good', selectionCycleId: 'c-good', status: 'SCHEDULED', scheduledAt: pastTime },
    ]);

    prisma.selectionCycle.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'c-good' });

    prisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: 'c-good',
      activeWeightVersionId: 'wv-1',
      eligibilityRuleVersionId: null,
    });
    prisma.weightVersion.findUnique.mockResolvedValue({
      id: 'wv-1',
      version: 1,
      weights: [],
    });
    prisma.studentRanking.findMany.mockResolvedValue([]);
    prisma.studentScore.findMany.mockResolvedValue([]);
    prisma.eligibilityResult.findMany.mockResolvedValue([]);
    prisma.hopePepClassification.findMany.mockResolvedValue([]);
    prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

    prisma.freezeSchedule.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'fs-good', status: 'SCHEDULED' })
      .mockResolvedValueOnce(null);

    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-good',
              version: 1,
              frozenAt: new Date(),
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
      },
    );

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.dueCount).toBe(2);
    expect(result.executedCount).toBe(1);
    expect(result.failedCount).toBe(1);

    const failed = result.results.find((r) => !r.success);
    expect(failed?.selectionCycleId).toBe('c-bad');
    expect(failed?.error).toBeDefined();

    const succeeded = result.results.find((r) => r.success);
    expect(succeeded?.selectionCycleId).toBe('c-good');
    expect(succeeded?.snapshotId).toBe('snap-good');
  });

  it('should use SYSTEM_SCHEDULER as the actor', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'SCHEDULED', scheduledAt: pastTime },
    ]);

    setupExecutionMocksFor(prisma, 'c1', 'snap-1');
    prisma.freezeSchedule.findFirst
      .mockResolvedValueOnce({ id: 'fs-1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(null);

    const now = new Date('2026-10-01T00:00:00Z');
    await service.processDueFreezes(now);

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FREEZE_EXECUTION_STARTED',
        actor: 'SYSTEM_SCHEDULER',
      }),
    );
  });

  it('should be idempotent — second call for already-executed freeze counts as failure without crashing', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'SCHEDULED', scheduledAt: pastTime },
    ]);

    prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.freezeSchedule.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'fs-exec', status: 'EXECUTED' });

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.dueCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.executedCount).toBe(0);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toMatch(/already been executed/);
  });

  it('should set checkedAt to the provided currentTime', async () => {
    prisma.freezeSchedule.findMany.mockResolvedValue([]);
    const now = new Date('2026-10-15T08:30:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.checkedAt).toBe(now);
  });

  it('should NOT emit a system-level PROCESS_DUE_FREEZES audit event (FK constraint)', async () => {
    // ScoreAuditLog.selectionCycleId has a FK constraint — 'SYSTEM' is not a valid
    // SelectionCycle.id, so emitting this event would fail in production.
    // Individual freeze executions emit their own audit events via executeFreeze().
    prisma.freezeSchedule.findMany.mockResolvedValue([]);
    const now = new Date('2026-10-15T08:30:00Z');
    await service.processDueFreezes(now);

    expect(mockAudit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROCESS_DUE_FREEZES' }),
    );
  });

  it('should not execute freezes with non-SCHEDULED statuses returned by query', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'EXECUTED', scheduledAt: pastTime },
      { id: 'fs-2', selectionCycleId: 'c2', status: 'CANCELLED', scheduledAt: pastTime },
    ]);

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.dueCount).toBe(0);
    expect(result.executedCount).toBe(0);
  });

  it('should return scheduleId and selectionCycleId for each result', async () => {
    const pastTime = new Date('2026-09-01T00:00:00Z');
    prisma.freezeSchedule.findMany.mockResolvedValue([
      { id: 'fs-1', selectionCycleId: 'c1', status: 'SCHEDULED', scheduledAt: pastTime },
    ]);

    setupExecutionMocksFor(prisma, 'c1', 'snap-1');
    prisma.freezeSchedule.findFirst
      .mockResolvedValueOnce({ id: 'fs-1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(null);

    const now = new Date('2026-10-01T00:00:00Z');
    const result = await service.processDueFreezes(now);
    expect(result.results[0].scheduleId).toBe('fs-1');
    expect(result.results[0].selectionCycleId).toBe('c1');
  });
});
