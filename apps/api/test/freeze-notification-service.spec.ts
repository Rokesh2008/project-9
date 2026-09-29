import { Test, TestingModule } from '@nestjs/testing';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

function createMockPrisma() {
  return {
    freezeNotificationEvent: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('FreezeNotificationService', () => {
  let service: FreezeNotificationService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FreezeNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(FreezeNotificationService);
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════
  // PLAN AND PERSIST
  // ═══════════════════════════════════════

  describe('planAndPersist', () => {
    it('should upsert exactly 5 notification events', async () => {
      const scheduledAt = new Date('2026-11-01T10:00:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);
      expect(prisma.freezeNotificationEvent.upsert).toHaveBeenCalledTimes(5);
    });

    it('should use unique constraint key (freezeScheduleId + eventType) for upsert', async () => {
      const scheduledAt = new Date('2026-11-01T10:00:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);

      const firstCall = prisma.freezeNotificationEvent.upsert.mock.calls[0][0];
      expect(firstCall.where).toEqual({
        freezeScheduleId_eventType: {
          freezeScheduleId: 'fs-1',
          eventType: 'FREEZE_SCHEDULED',
        },
      });
    });

    it('should create SKIPPED events for past reminder times', async () => {
      const scheduledAt = new Date('2026-10-01T10:30:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);

      const calls = prisma.freezeNotificationEvent.upsert.mock.calls;
      const sevenDayCall = calls.find(
        (c: any) => c[0].create.eventType === 'FREEZE_7_DAYS_BEFORE',
      );
      expect(sevenDayCall[0].create.status).toBe('SKIPPED');
    });

    it('should be idempotent — calling twice does not fail (upsert)', async () => {
      const scheduledAt = new Date('2026-11-01T10:00:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);
      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);

      expect(prisma.freezeNotificationEvent.upsert).toHaveBeenCalledTimes(10);
    });

    it('should log FREEZE_NOTIFICATIONS_PLANNED audit event', async () => {
      const scheduledAt = new Date('2026-11-01T10:00:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FREEZE_NOTIFICATIONS_PLANNED',
          entityId: 'fs-1',
          metadata: expect.objectContaining({
            eventCount: 5,
          }),
        }),
      );
    });

    it('should not modify RankingSnapshot or RankingSnapshotEntry', async () => {
      const scheduledAt = new Date('2026-11-01T10:00:00Z');
      const createdAt = new Date('2026-10-01T10:00:00Z');

      await service.planAndPersist('cycle-1', 'fs-1', scheduledAt, createdAt);

      expect((prisma as any).rankingSnapshot).toBeUndefined();
      expect((prisma as any).rankingSnapshotEntry).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════
  // CANCEL EVENTS FOR SCHEDULE
  // ═══════════════════════════════════════

  describe('cancelEventsForSchedule', () => {
    it('should update all PENDING events to CANCELLED', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      expect(result).toBe(3);
      expect(prisma.freezeNotificationEvent.updateMany).toHaveBeenCalledWith({
        where: {
          freezeScheduleId: 'fs-old',
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
        },
      });
    });

    it('should log FREEZE_NOTIFICATIONS_CANCELLED when events were cancelled', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 2 });

      await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FREEZE_NOTIFICATIONS_CANCELLED',
          metadata: expect.objectContaining({ cancelledCount: 2 }),
        }),
      );
    });

    it('should not log audit when no events were cancelled', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 0 });

      await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('should not affect SKIPPED or SENT events', async () => {
      await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      const call = prisma.freezeNotificationEvent.updateMany.mock.calls[0][0];
      expect(call.where.status).toBe('PENDING');
    });

    it('should not modify any snapshot data', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 1 });
      await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      expect((prisma as any).rankingSnapshot).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════
  // MARK EXECUTED
  // ═══════════════════════════════════════

  describe('markExecuted', () => {
    it('should mark FREEZE_EXECUTED event as SENT', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 1 });

      await service.markExecuted('cycle-1', 'fs-1');

      expect(prisma.freezeNotificationEvent.updateMany).toHaveBeenCalledWith({
        where: {
          freezeScheduleId: 'fs-1',
          eventType: 'FREEZE_EXECUTED',
          status: 'PENDING',
        },
        data: {
          status: 'SENT',
        },
      });
    });

    it('should cancel remaining PENDING events after execution', async () => {
      prisma.freezeNotificationEvent.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 2 });

      await service.markExecuted('cycle-1', 'fs-1');

      expect(prisma.freezeNotificationEvent.updateMany).toHaveBeenCalledTimes(2);
      const secondCall = prisma.freezeNotificationEvent.updateMany.mock.calls[1][0];
      expect(secondCall.where.status).toBe('PENDING');
      expect(secondCall.data.status).toBe('CANCELLED');
    });

    it('should log FREEZE_EXECUTION_NOTIFICATION_SENT audit event', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 0 });

      await service.markExecuted('cycle-1', 'fs-1');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FREEZE_EXECUTION_NOTIFICATION_SENT',
        }),
      );
    });
  });

  // ═══════════════════════════════════════
  // POSTPONEMENT SCENARIO
  // ═══════════════════════════════════════

  describe('postponement — cancel old + plan new', () => {
    it('should cancel old events and plan new events for new schedule', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 4 });

      await service.cancelEventsForSchedule('cycle-1', 'fs-old');
      expect(prisma.freezeNotificationEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { freezeScheduleId: 'fs-old', status: 'PENDING' },
        }),
      );

      jest.clearAllMocks();

      const newScheduledAt = new Date('2026-11-15T10:00:00Z');
      const newCreatedAt = new Date('2026-10-20T10:00:00Z');
      await service.planAndPersist('cycle-1', 'fs-new', newScheduledAt, newCreatedAt);

      expect(prisma.freezeNotificationEvent.upsert).toHaveBeenCalledTimes(5);
      const firstUpsert = prisma.freezeNotificationEvent.upsert.mock.calls[0][0];
      expect(firstUpsert.create.freezeScheduleId).toBe('fs-new');
    });

    it('should not reuse old freezeScheduleId events for new schedule', async () => {
      const newScheduledAt = new Date('2026-11-15T10:00:00Z');
      const newCreatedAt = new Date('2026-10-20T10:00:00Z');
      await service.planAndPersist('cycle-1', 'fs-new', newScheduledAt, newCreatedAt);

      const allCalls = prisma.freezeNotificationEvent.upsert.mock.calls;
      for (const call of allCalls) {
        expect(call[0].create.freezeScheduleId).toBe('fs-new');
        expect(call[0].where.freezeScheduleId_eventType.freezeScheduleId).toBe('fs-new');
      }
    });
  });

  // ═══════════════════════════════════════
  // READ EVENTS
  // ═══════════════════════════════════════

  describe('getEventsForCycle', () => {
    it('should return events ordered by plannedAt', async () => {
      const mockEvents = [
        { id: 'e1', freezeScheduleId: 'fs-1', eventType: 'FREEZE_SCHEDULED', plannedAt: new Date(), status: 'PENDING', createdAt: new Date() },
        { id: 'e2', freezeScheduleId: 'fs-1', eventType: 'FREEZE_EXECUTED', plannedAt: new Date(), status: 'PENDING', createdAt: new Date() },
      ];
      prisma.freezeNotificationEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEventsForCycle('cycle-1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('e1');
    });
  });

  describe('getEventsForSchedule', () => {
    it('should return events for a specific schedule', async () => {
      const mockEvents = [
        { id: 'e1', eventType: 'FREEZE_SCHEDULED', plannedAt: new Date(), status: 'PENDING', createdAt: new Date() },
      ];
      prisma.freezeNotificationEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEventsForSchedule('fs-1');
      expect(result).toHaveLength(1);
      expect(prisma.freezeNotificationEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { freezeScheduleId: 'fs-1' },
        }),
      );
    });
  });

  // ═══════════════════════════════════════
  // SNAPSHOT SAFETY
  // ═══════════════════════════════════════

  describe('snapshot safety', () => {
    it('planAndPersist does not touch snapshot tables', async () => {
      await service.planAndPersist('c', 'fs', new Date('2026-12-01'), new Date('2026-10-01'));
      expect((prisma as any).rankingSnapshot).toBeUndefined();
      expect((prisma as any).rankingSnapshotEntry).toBeUndefined();
    });

    it('cancelEventsForSchedule does not touch snapshot tables', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 0 });
      await service.cancelEventsForSchedule('c', 'fs');
      expect((prisma as any).rankingSnapshot).toBeUndefined();
    });

    it('markExecuted does not touch snapshot tables', async () => {
      prisma.freezeNotificationEvent.updateMany.mockResolvedValue({ count: 0 });
      await service.markExecuted('c', 'fs');
      expect((prisma as any).rankingSnapshot).toBeUndefined();
    });
  });
});
