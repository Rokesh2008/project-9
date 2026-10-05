import {
  planFreezeNotifications,
  type PlannedNotificationEvent,
} from '../src/member1/freeze/freeze-notification.engine';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('planFreezeNotifications', () => {
  const scheduledAt = new Date('2026-11-01T10:00:00Z');
  const createdAt = new Date('2026-10-01T10:00:00Z');

  it('should return exactly 5 events', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    expect(events).toHaveLength(5);
  });

  it('should create an immediate FREEZE_SCHEDULED event at createdAt', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const scheduled = events.find((e) => e.eventType === 'FREEZE_SCHEDULED');
    expect(scheduled).toBeDefined();
    expect(scheduled!.plannedAt).toEqual(createdAt);
    expect(scheduled!.status).toBe('PENDING');
  });

  it('should always create FREEZE_SCHEDULED as PENDING regardless of timing', () => {
    const events = planFreezeNotifications(scheduledAt, scheduledAt);
    const scheduled = events.find((e) => e.eventType === 'FREEZE_SCHEDULED');
    expect(scheduled!.status).toBe('PENDING');
  });

  it('should calculate FREEZE_7_DAYS_BEFORE correctly', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const event = events.find((e) => e.eventType === 'FREEZE_7_DAYS_BEFORE');
    expect(event).toBeDefined();
    expect(event!.plannedAt.getTime()).toBe(scheduledAt.getTime() - SEVEN_DAYS_MS);
    expect(event!.status).toBe('PENDING');
  });

  it('should calculate FREEZE_24_HOURS_BEFORE correctly', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const event = events.find((e) => e.eventType === 'FREEZE_24_HOURS_BEFORE');
    expect(event).toBeDefined();
    expect(event!.plannedAt.getTime()).toBe(scheduledAt.getTime() - TWENTY_FOUR_HOURS_MS);
    expect(event!.status).toBe('PENDING');
  });

  it('should calculate FREEZE_1_HOUR_BEFORE correctly', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const event = events.find((e) => e.eventType === 'FREEZE_1_HOUR_BEFORE');
    expect(event).toBeDefined();
    expect(event!.plannedAt.getTime()).toBe(scheduledAt.getTime() - ONE_HOUR_MS);
    expect(event!.status).toBe('PENDING');
  });

  it('should create FREEZE_EXECUTED event at scheduledAt', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const event = events.find((e) => e.eventType === 'FREEZE_EXECUTED');
    expect(event).toBeDefined();
    expect(event!.plannedAt).toEqual(scheduledAt);
    expect(event!.status).toBe('PENDING');
  });

  it('should mark past reminder events as SKIPPED when schedule is created close to freeze time', () => {
    const closeCreatedAt = new Date('2026-11-01T09:30:00Z');
    const events = planFreezeNotifications(scheduledAt, closeCreatedAt);

    const sevenDay = events.find((e) => e.eventType === 'FREEZE_7_DAYS_BEFORE');
    const twentyFourHour = events.find((e) => e.eventType === 'FREEZE_24_HOURS_BEFORE');
    const oneHour = events.find((e) => e.eventType === 'FREEZE_1_HOUR_BEFORE');
    const executed = events.find((e) => e.eventType === 'FREEZE_EXECUTED');

    expect(sevenDay!.status).toBe('SKIPPED');
    expect(twentyFourHour!.status).toBe('SKIPPED');
    expect(oneHour!.status).toBe('SKIPPED');
    expect(executed!.status).toBe('PENDING');
  });

  it('should mark FREEZE_EXECUTED as SKIPPED if scheduledAt is already past', () => {
    const pastScheduledAt = new Date('2026-09-01T10:00:00Z');
    const events = planFreezeNotifications(pastScheduledAt, createdAt);
    const executed = events.find((e) => e.eventType === 'FREEZE_EXECUTED');
    expect(executed!.status).toBe('SKIPPED');
  });

  it('should mark reminder as SKIPPED when exactly at boundary (plannedAt == createdAt)', () => {
    const exactBoundary = new Date(scheduledAt.getTime() - ONE_HOUR_MS);
    const events = planFreezeNotifications(scheduledAt, exactBoundary);
    const oneHour = events.find((e) => e.eventType === 'FREEZE_1_HOUR_BEFORE');
    expect(oneHour!.status).toBe('SKIPPED');
  });

  it('should keep reminder PENDING when 1ms before boundary', () => {
    const justBefore = new Date(scheduledAt.getTime() - ONE_HOUR_MS - 1);
    const events = planFreezeNotifications(scheduledAt, justBefore);
    const oneHour = events.find((e) => e.eventType === 'FREEZE_1_HOUR_BEFORE');
    expect(oneHour!.status).toBe('PENDING');
  });

  it('should be deterministic — same inputs produce identical output', () => {
    const r1 = planFreezeNotifications(scheduledAt, createdAt);
    const r2 = planFreezeNotifications(scheduledAt, createdAt);
    expect(r1).toEqual(r2);
  });

  it('should not mutate input dates', () => {
    const s = new Date('2026-11-01T10:00:00Z');
    const c = new Date('2026-10-01T10:00:00Z');
    const sTime = s.getTime();
    const cTime = c.getTime();
    planFreezeNotifications(s, c);
    expect(s.getTime()).toBe(sTime);
    expect(c.getTime()).toBe(cTime);
  });

  it('should return events with unique event types', () => {
    const events = planFreezeNotifications(scheduledAt, createdAt);
    const types = events.map((e) => e.eventType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('should handle freeze scheduled far in the future — all events PENDING', () => {
    const farFuture = new Date('2027-06-01T10:00:00Z');
    const now = new Date('2026-10-01T10:00:00Z');
    const events = planFreezeNotifications(farFuture, now);
    expect(events.every((e) => e.status === 'PENDING')).toBe(true);
  });

  it('should handle freeze scheduled in the past — all reminders SKIPPED', () => {
    const past = new Date('2026-09-01T10:00:00Z');
    const now = new Date('2026-10-01T10:00:00Z');
    const events = planFreezeNotifications(past, now);
    const reminders = events.filter((e) => e.eventType !== 'FREEZE_SCHEDULED');
    expect(reminders.every((e) => e.status === 'SKIPPED')).toBe(true);
    expect(events.find((e) => e.eventType === 'FREEZE_SCHEDULED')!.status).toBe('PENDING');
  });

  it('should produce correct mixed PENDING/SKIPPED when created 2 days before freeze', () => {
    const twoDaysBefore = new Date(scheduledAt.getTime() - 2 * TWENTY_FOUR_HOURS_MS);
    const events = planFreezeNotifications(scheduledAt, twoDaysBefore);

    expect(events.find((e) => e.eventType === 'FREEZE_SCHEDULED')!.status).toBe('PENDING');
    expect(events.find((e) => e.eventType === 'FREEZE_7_DAYS_BEFORE')!.status).toBe('SKIPPED');
    expect(events.find((e) => e.eventType === 'FREEZE_24_HOURS_BEFORE')!.status).toBe('PENDING');
    expect(events.find((e) => e.eventType === 'FREEZE_1_HOUR_BEFORE')!.status).toBe('PENDING');
    expect(events.find((e) => e.eventType === 'FREEZE_EXECUTED')!.status).toBe('PENDING');
  });
});
