import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { planFreezeNotifications } from './freeze-notification.engine';

@Injectable()
export class FreezeNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async planAndPersist(
    selectionCycleId: string,
    freezeScheduleId: string,
    scheduledAt: Date,
    createdAt: Date,
  ): Promise<void> {
    const planned = planFreezeNotifications(scheduledAt, createdAt);

    for (const event of planned) {
      await this.prisma.freezeNotificationEvent.upsert({
        where: {
          freezeScheduleId_eventType: {
            freezeScheduleId,
            eventType: event.eventType,
          },
        },
        create: {
          selectionCycleId,
          freezeScheduleId,
          eventType: event.eventType,
          plannedAt: event.plannedAt,
          status: event.status,
        },
        update: {
          plannedAt: event.plannedAt,
          status: event.status,
        },
      });
    }

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_NOTIFICATIONS_PLANNED',
      actor: 'SYSTEM',
      entityType: 'FreezeSchedule',
      entityId: freezeScheduleId,
      metadata: {
        eventCount: planned.length,
        pendingCount: planned.filter((e) => e.status === 'PENDING').length,
        skippedCount: planned.filter((e) => e.status === 'SKIPPED').length,
      },
    });
  }

  async cancelEventsForSchedule(
    selectionCycleId: string,
    freezeScheduleId: string,
  ): Promise<number> {
    const result = await this.prisma.freezeNotificationEvent.updateMany({
      where: {
        freezeScheduleId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    if (result.count > 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'FREEZE_NOTIFICATIONS_CANCELLED',
        actor: 'SYSTEM',
        entityType: 'FreezeSchedule',
        entityId: freezeScheduleId,
        metadata: {
          cancelledCount: result.count,
        },
      });
    }

    return result.count;
  }

  async markExecuted(
    selectionCycleId: string,
    freezeScheduleId: string,
  ): Promise<void> {
    await this.prisma.freezeNotificationEvent.updateMany({
      where: {
        freezeScheduleId,
        eventType: 'FREEZE_EXECUTED',
        status: 'PENDING',
      },
      data: {
        status: 'SENT',
      },
    });

    await this.prisma.freezeNotificationEvent.updateMany({
      where: {
        freezeScheduleId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_EXECUTION_NOTIFICATION_SENT',
      actor: 'SYSTEM',
      entityType: 'FreezeSchedule',
      entityId: freezeScheduleId,
    });
  }

  async getEventsForSchedule(
    freezeScheduleId: string,
  ): Promise<
    Array<{
      id: string;
      eventType: string;
      plannedAt: Date;
      status: string;
      createdAt: Date;
    }>
  > {
    const events = await this.prisma.freezeNotificationEvent.findMany({
      where: { freezeScheduleId },
      orderBy: { plannedAt: 'asc' },
    });

    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      plannedAt: e.plannedAt,
      status: e.status,
      createdAt: e.createdAt,
    }));
  }

  async getEventsForCycle(
    selectionCycleId: string,
  ): Promise<
    Array<{
      id: string;
      freezeScheduleId: string;
      eventType: string;
      plannedAt: Date;
      status: string;
      createdAt: Date;
    }>
  > {
    const events = await this.prisma.freezeNotificationEvent.findMany({
      where: { selectionCycleId },
      orderBy: [{ freezeScheduleId: 'asc' }, { plannedAt: 'asc' }],
    });

    return events.map((e) => ({
      id: e.id,
      freezeScheduleId: e.freezeScheduleId,
      eventType: e.eventType,
      plannedAt: e.plannedAt,
      status: e.status,
      createdAt: e.createdAt,
    }));
  }
}
