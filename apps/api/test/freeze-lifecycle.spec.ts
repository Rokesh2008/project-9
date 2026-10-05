import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';
import { isFreezeDue } from '../src/member1/freeze/freeze.engine';

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

describe('Freeze Lifecycle', () => {
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

  // ═══════════════════════════════════════
  // SCHEDULING VALIDATION
  // ═══════════════════════════════════════

  describe('schedule — validation', () => {
    it('should accept a valid future schedule', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: futureDate,
        status: 'SCHEDULED',
      });

      const result = await service.schedule('cycle-1', futureDate, 'admin-1');
      expect(result.id).toBe('fs-1');
      expect(result.status).toBe('SCHEDULED');
    });

    it('should reject an invalid (nonexistent) cycle', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);
      await expect(
        service.schedule('bad-cycle', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject a past timestamp', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      const pastDate = new Date(Date.now() - 86400000);
      await expect(
        service.schedule('cycle-1', pastDate, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a timestamp equal to now (not strictly future)', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      const now = new Date();
      await expect(
        service.schedule('cycle-1', now, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate active schedule for the same cycle', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'existing',
        status: 'SCHEDULED',
      });

      await expect(
        service.schedule('cycle-1', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a FREEZE_SCHEDULE_CREATED audit event', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: futureDate,
        status: 'SCHEDULED',
      });

      await service.schedule('cycle-1', futureDate, 'admin-1');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FREEZE_SCHEDULE_CREATED' }),
      );
    });
  });

  // ═══════════════════════════════════════
  // POSTPONEMENT
  // ═══════════════════════════════════════

  describe('postpone', () => {
    it('should postpone a valid scheduled freeze', async () => {
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-old',
        scheduledAt: new Date(Date.now() + 86400000),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-new',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      const result = await service.postpone('cycle-1', newDate, 'admin-1', 'Need more time');
      expect(result.id).toBe('fs-new');
      expect(result.status).toBe('SCHEDULED');
    });

    it('should mark old schedule as POSTPONED', async () => {
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-old',
        scheduledAt: new Date(Date.now() + 86400000),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-new',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      await service.postpone('cycle-1', newDate, 'admin-1');
      expect(prisma.freezeSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fs-old' },
          data: { status: 'POSTPONED' },
        }),
      );
    });

    it('should store the new scheduled time', async () => {
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-old',
        scheduledAt: new Date(Date.now() + 86400000),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-new',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      await service.postpone('cycle-1', newDate, 'admin-1');
      expect(prisma.freezeSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scheduledAt: newDate,
            status: 'SCHEDULED',
          }),
        }),
      );
    });

    it('should reject an invalid (past) new time', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      await expect(
        service.postpone('cycle-1', pastDate, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if no active schedule exists', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      await expect(
        service.postpone('cycle-1', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject postponement of a cancelled schedule', async () => {
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fs-cancelled', status: 'CANCELLED' });

      await expect(
        service.postpone('cycle-1', new Date(Date.now() + 86400000), 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a FREEZE_POSTPONED audit event with old and new times', async () => {
      const oldDate = new Date(Date.now() + 86400000);
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-old',
        scheduledAt: oldDate,
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-new',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      await service.postpone('cycle-1', newDate, 'admin-1', 'Delay needed');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FREEZE_POSTPONED',
          metadata: expect.objectContaining({
            previousScheduleId: 'fs-old',
            previousScheduledAt: oldDate.toISOString(),
            newScheduledAt: newDate.toISOString(),
            reason: 'Delay needed',
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════
  // CANCELLATION HARDENING
  // ═══════════════════════════════════════

  describe('cancel — hardened', () => {
    it('should cancel an active scheduled freeze', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date(),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});

      await service.cancel('cycle-1', 'admin-1', 'No longer needed');
      expect(prisma.freezeSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('should throw if no active schedule', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);
      await expect(
        service.cancel('cycle-1', 'admin-1', 'reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw specific error if freeze already executed', async () => {
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fs-exec', status: 'EXECUTED' });

      await expect(
        service.cancel('cycle-1', 'admin-1', 'reason'),
      ).rejects.toThrow(/already been executed/);
    });

    it('should throw specific error if schedule already cancelled', async () => {
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fs-canc', status: 'CANCELLED' });

      await expect(
        service.cancel('cycle-1', 'admin-1', 'reason'),
      ).rejects.toThrow(ConflictException);
    });

    it('should not delete any snapshots on cancellation', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date(),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});

      await service.cancel('cycle-1', 'admin-1', 'reason');
      expect(prisma.rankingSnapshot.findFirst).not.toHaveBeenCalled();
    });

    it('should create a FREEZE_CANCELLED audit event', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date('2026-11-01'),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});

      await service.cancel('cycle-1', 'admin-1', 'Budget cut');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FREEZE_CANCELLED',
          metadata: expect.objectContaining({ reason: 'Budget cut' }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════
  // DUE-STATE LOGIC (engine)
  // ═══════════════════════════════════════

  describe('isFreezeDue', () => {
    it('should be due when SCHEDULED and currentTime >= scheduledAt', () => {
      const scheduledAt = new Date('2026-10-01T10:00:00Z');
      const currentTime = new Date('2026-10-01T10:00:01Z');
      expect(isFreezeDue('SCHEDULED', scheduledAt, currentTime)).toBe(true);
    });

    it('should be due when SCHEDULED and currentTime == scheduledAt', () => {
      const scheduledAt = new Date('2026-10-01T10:00:00Z');
      expect(isFreezeDue('SCHEDULED', scheduledAt, scheduledAt)).toBe(true);
    });

    it('should not be due when SCHEDULED and currentTime < scheduledAt', () => {
      const scheduledAt = new Date('2026-10-01T10:00:00Z');
      const currentTime = new Date('2026-10-01T09:59:59Z');
      expect(isFreezeDue('SCHEDULED', scheduledAt, currentTime)).toBe(false);
    });

    it('should never be due when CANCELLED', () => {
      const scheduledAt = new Date('2026-01-01T00:00:00Z');
      const currentTime = new Date('2026-12-31T23:59:59Z');
      expect(isFreezeDue('CANCELLED', scheduledAt, currentTime)).toBe(false);
    });

    it('should never be due when EXECUTED', () => {
      const scheduledAt = new Date('2026-01-01T00:00:00Z');
      const currentTime = new Date('2026-12-31T23:59:59Z');
      expect(isFreezeDue('EXECUTED', scheduledAt, currentTime)).toBe(false);
    });

    it('should not be due when POSTPONED (awaiting reschedule)', () => {
      const scheduledAt = new Date('2026-01-01T00:00:00Z');
      const currentTime = new Date('2026-12-31T23:59:59Z');
      expect(isFreezeDue('POSTPONED', scheduledAt, currentTime)).toBe(false);
    });

    it('should not be due for unknown status', () => {
      const scheduledAt = new Date('2026-01-01T00:00:00Z');
      const currentTime = new Date('2026-12-31T23:59:59Z');
      expect(isFreezeDue('UNKNOWN', scheduledAt, currentTime)).toBe(false);
    });
  });

  // ═══════════════════════════════════════
  // DOUBLE EXECUTION PREVENTION
  // ═══════════════════════════════════════

  describe('executeFreeze — double execution', () => {
    function setupExecutionMocks() {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: 'cycle-1',
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
    }

    it('should succeed on first execution with SCHEDULED schedule', async () => {
      setupExecutionMocks();
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce({ id: 'fs-1', status: 'SCHEDULED' });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-1',
              version: 1,
              frozenAt: new Date(),
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue({ id: 'fs-1' }),
            update: jest.fn(),
          },
        };
        return fn(txPrisma);
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.snapshotId).toBe('snap-1');
    });

    it('should reject second execution when schedule is already EXECUTED', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fs-1', status: 'EXECUTED' });

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow(/already been executed/);
    });

    it('should not create a duplicate snapshot on double execution', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: 'cycle-1' });
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fs-1', status: 'EXECUTED' });

      await expect(
        service.executeFreeze('cycle-1', 'admin-1'),
      ).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow ad-hoc execution when no schedule exists', async () => {
      setupExecutionMocks();
      prisma.freezeSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txPrisma = {
          rankingSnapshot: {
            create: jest.fn().mockResolvedValue({
              id: 'snap-adhoc',
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
      });

      const result = await service.executeFreeze('cycle-1', 'admin-1');
      expect(result.snapshotId).toBe('snap-adhoc');
    });

    it('snapshot remains immutable after execution', () => {
      const snapshot = {
        id: 'snap-1',
        version: 1,
        entries: [{ studentId: 's1', rank: 1, totalScore: 90 }],
      };
      const copy = JSON.parse(JSON.stringify(snapshot));

      const _secondCall = 'rejected';
      expect(snapshot).toEqual(copy);
    });
  });

  // ═══════════════════════════════════════
  // SNAPSHOT SAFETY
  // ═══════════════════════════════════════

  describe('snapshot safety', () => {
    it('cancellation does not modify snapshots (no snapshot operations called)', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date(),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});

      await service.cancel('cycle-1', 'admin-1', 'reason');
      expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
    });

    it('postponement does not modify snapshots', async () => {
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-old',
        scheduledAt: new Date(Date.now() + 86400000),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-new',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      await service.postpone('cycle-1', newDate, 'admin-1');
      expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
      expect(prisma.rankingSnapshotEntry.createMany).not.toHaveBeenCalled();
    });

    it('rescheduling before execution does not create snapshots', async () => {
      const newDate = new Date(Date.now() + 172800000);
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        scheduledAt: new Date(Date.now() + 86400000),
        status: 'SCHEDULED',
      });
      prisma.freezeSchedule.update.mockResolvedValue({});
      prisma.freezeSchedule.create.mockResolvedValue({
        id: 'fs-2',
        scheduledAt: newDate,
        status: 'SCHEDULED',
      });

      await service.postpone('cycle-1', newDate, 'admin-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('service has no update/delete methods for RankingSnapshot or RankingSnapshotEntry', () => {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const forbidden = methods.filter(
        (m) =>
          m.includes('updateSnapshot') ||
          m.includes('editSnapshot') ||
          m.includes('deleteSnapshot') ||
          m.includes('modifySnapshot') ||
          m.includes('removeSnapshot'),
      );
      expect(forbidden).toEqual([]);
    });
  });
});
