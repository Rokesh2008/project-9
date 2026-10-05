export type NotificationEventType =
  | 'FREEZE_SCHEDULED'
  | 'FREEZE_7_DAYS_BEFORE'
  | 'FREEZE_24_HOURS_BEFORE'
  | 'FREEZE_1_HOUR_BEFORE'
  | 'FREEZE_EXECUTED';

export type NotificationEventStatus = 'PENDING' | 'SKIPPED';

export interface PlannedNotificationEvent {
  eventType: NotificationEventType;
  plannedAt: Date;
  status: NotificationEventStatus;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export function planFreezeNotifications(
  scheduledAt: Date,
  createdAt: Date,
): PlannedNotificationEvent[] {
  const events: PlannedNotificationEvent[] = [];

  events.push({
    eventType: 'FREEZE_SCHEDULED',
    plannedAt: createdAt,
    status: 'PENDING',
  });

  const reminders: Array<{ type: NotificationEventType; offsetMs: number }> = [
    { type: 'FREEZE_7_DAYS_BEFORE', offsetMs: SEVEN_DAYS_MS },
    { type: 'FREEZE_24_HOURS_BEFORE', offsetMs: TWENTY_FOUR_HOURS_MS },
    { type: 'FREEZE_1_HOUR_BEFORE', offsetMs: ONE_HOUR_MS },
  ];

  for (const reminder of reminders) {
    const plannedAt = new Date(scheduledAt.getTime() - reminder.offsetMs);
    events.push({
      eventType: reminder.type,
      plannedAt,
      status: plannedAt.getTime() <= createdAt.getTime() ? 'SKIPPED' : 'PENDING',
    });
  }

  events.push({
    eventType: 'FREEZE_EXECUTED',
    plannedAt: scheduledAt,
    status: scheduledAt.getTime() <= createdAt.getTime() ? 'SKIPPED' : 'PENDING',
  });

  return events;
}
