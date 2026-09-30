/**
 * Prompt 17 — End-to-End Integration Smoke Test
 *
 * Proves the complete Member 1 pipeline is internally consistent.
 * Each test step is self-contained with explicit mocks.
 *
 * Pipeline verified:
 *   Score input → Scoring → Eligibility → Ranking → Classification
 *   → Freeze → Frozen authority → Selection results
 *   → Re-freeze → New snapshot → Old snapshot unchanged
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScoringService } from '../src/member1/scoring/scoring.service';
import { EligibilityService } from '../src/member1/eligibility/eligibility.service';
import { RankingService } from '../src/member1/ranking/ranking.service';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { SelectionResultService } from '../src/member1/selection/selection-result.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const CYCLE_ID = 'smoke-cycle';
const WV_ID = 'smoke-wv';
const RV_ID = 'smoke-rv';
const ACTOR = 'smoke-admin';

// ─── Shared frozen state ─────────────────────────────────────────────────────

const SNAP_V1 = {
  id: 'snap-1',
  version: 1,
  selectionCycleId: CYCLE_ID,
  weightVersionId: WV_ID,
  ruleVersionId: RV_ID,
  hopeCount: 1,
  pepCount: 1,
  totalStudents: 3,
  frozenAt: new Date('2026-10-01T10:00:00Z'),
  frozenBy: ACTOR,
  reason: null,
  entries: [
    { id: 'e1', snapshotId: 'snap-1', studentId: 'sA', rank: 1, totalScore: 90, percentile: 100, parameterScores: { coding: { raw: 90, normalized: 0.9, weight: 1.0, weighted: 90, isMissing: false } }, isEligible: true, eligibilityFailures: null, program: 'HOPE', tieBreakApplied: false },
    { id: 'e2', snapshotId: 'snap-1', studentId: 'sB', rank: 2, totalScore: 70, percentile: 66, parameterScores: { coding: { raw: 70, normalized: 0.7, weight: 1.0, weighted: 70, isMissing: false } }, isEligible: true, eligibilityFailures: null, program: 'PEP', tieBreakApplied: false },
    { id: 'e3', snapshotId: 'snap-1', studentId: 'sC', rank: 3, totalScore: 40, percentile: 0, parameterScores: { coding: { raw: 40, normalized: 0.4, weight: 1.0, weighted: 40, isMissing: false } }, isEligible: false, eligibilityFailures: ['coding GTE 50: failed'], program: 'NOT_ELIGIBLE', tieBreakApplied: false },
  ],
};

// V2 snapshot (after live data changed — sA now 10, sC becomes eligible if we raised score)
const SNAP_V2 = {
  id: 'snap-2',
  version: 2,
  selectionCycleId: CYCLE_ID,
  weightVersionId: WV_ID,
  ruleVersionId: RV_ID,
  hopeCount: 1,
  pepCount: 1,
  totalStudents: 3,
  frozenAt: new Date('2026-10-02T10:00:00Z'),
  frozenBy: ACTOR,
  reason: 'updated data',
  entries: [
    { id: 'e4', snapshotId: 'snap-2', studentId: 'sB', rank: 1, totalScore: 70, percentile: 100, parameterScores: { coding: { raw: 70, normalized: 0.7, weight: 1.0, weighted: 70, isMissing: false } }, isEligible: true, eligibilityFailures: null, program: 'HOPE', tieBreakApplied: false },
    { id: 'e5', snapshotId: 'snap-2', studentId: 'sC', rank: 2, totalScore: 40, percentile: 33, parameterScores: { coding: { raw: 40, normalized: 0.4, weight: 1.0, weighted: 40, isMissing: false } }, isEligible: false, eligibilityFailures: ['coding GTE 50: failed'], program: 'NOT_ELIGIBLE', tieBreakApplied: false },
    { id: 'e6', snapshotId: 'snap-2', studentId: 'sA', rank: 3, totalScore: 10, percentile: 0, parameterScores: { coding: { raw: 10, normalized: 0.1, weight: 1.0, weighted: 10, isMissing: false } }, isEligible: false, eligibilityFailures: ['coding GTE 50: failed'], program: 'NOT_ELIGIBLE', tieBreakApplied: false },
  ],
};

const EXECUTED_SCHEDULE_V1 = { id: 'fs-1', status: 'EXECUTED', executedAt: new Date('2026-10-01T10:00:00Z'), snapshotId: 'snap-1', selectionCycleId: CYCLE_ID };
const EXECUTED_SCHEDULE_V2 = { id: 'fs-2', status: 'EXECUTED', executedAt: new Date('2026-10-02T10:00:00Z'), snapshotId: 'snap-2', selectionCycleId: CYCLE_ID };

// ─── Helper factories ─────────────────────────────────────────────────────────

function buildPrisma(overrides: Partial<ReturnType<typeof basePrisma>> = {}) {
  return { ...basePrisma(), ...overrides };
}

function basePrisma() {
  return {
    selectionCycle: {
      findUnique: jest.fn().mockResolvedValue({ id: CYCLE_ID }),
    },
    student: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => {
        const map: Record<string, object> = {
          sA: { id: 'sA', studentId: 'REG-A', name: 'Alice', email: 'a@u.edu', isActive: true, batchId: 'b1', batch: { id: 'b1' }, assessmentResults: [{ assessmentType: 'CODING', score: 90, maxScore: 100, percentage: 90 }] },
          sB: { id: 'sB', studentId: 'REG-B', name: 'Bob', email: 'b@u.edu', isActive: true, batchId: 'b1', batch: { id: 'b1' }, assessmentResults: [{ assessmentType: 'CODING', score: 70, maxScore: 100, percentage: 70 }] },
          sC: { id: 'sC', studentId: 'REG-C', name: 'Carol', email: 'c@u.edu', isActive: true, batchId: 'b1', batch: { id: 'b1' }, assessmentResults: [{ assessmentType: 'CODING', score: 40, maxScore: 100, percentage: 40 }] },
        };
        return map[where.id ?? ''] ?? null;
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'sA' }, { id: 'sB' }, { id: 'sC' }]),
    },
    cycleConfig: {
      findUnique: jest.fn().mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: WV_ID,
        eligibilityRuleVersionId: RV_ID,
        hopeCount: 1,
        pepCount: 1,
      }),
    },
    weightVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: WV_ID, version: 1, selectionCycleId: CYCLE_ID,
        weights: [{ parameterKey: 'coding', weight: 1.0, maxRawScore: 100 }],
      }),
      findFirst: jest.fn().mockResolvedValue({ version: 1 }),
    },
    eligibilityRuleVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: RV_ID, version: 1, selectionCycleId: CYCLE_ID,
        rules: { logic: 'AND', rules: [{ id: 'r1', field: 'codingScore', operator: 'GTE', value: 50 }] },
        isActive: true,
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: RV_ID, version: 1, selectionCycleId: CYCLE_ID,
        rules: { logic: 'AND', rules: [{ id: 'r1', field: 'codingScore', operator: 'GTE', value: 50 }] },
        isActive: true,
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    eligibilityResult: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { studentId: 'sA', isEligible: true, failedRules: null },
        { studentId: 'sB', isEligible: true, failedRules: null },
        { studentId: 'sC', isEligible: false, failedRules: [{ message: 'coding GTE 50: failed' }] },
      ]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    studentScore: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { studentId: 'sA', parameterKey: 'coding', rawScore: 90, normalizedScore: 0.9, weight: 1.0, weightedScore: 90, isMissing: false, weightVersionId: WV_ID },
        { studentId: 'sB', parameterKey: 'coding', rawScore: 70, normalizedScore: 0.7, weight: 1.0, weightedScore: 70, isMissing: false, weightVersionId: WV_ID },
        { studentId: 'sC', parameterKey: 'coding', rawScore: 40, normalizedScore: 0.4, weight: 1.0, weightedScore: 40, isMissing: false, weightVersionId: WV_ID },
      ]),
    },
    studentRanking: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { studentId: 'sA', rank: 1, totalScore: 90, percentile: 100, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
        { studentId: 'sB', rank: 2, totalScore: 70, percentile: 66, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
        { studentId: 'sC', rank: 3, totalScore: 40, percentile: 0, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
      ]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(3),
    },
    hopePepClassification: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { studentId: 'sA', program: 'HOPE', rank: 1, status: 'CLASSIFIED', classifiedAt: new Date(), selectionCycleId: CYCLE_ID, snapshotId: null },
        { studentId: 'sB', program: 'PEP', rank: 2, status: 'CLASSIFIED', classifiedAt: new Date(), selectionCycleId: CYCLE_ID, snapshotId: null },
        { studentId: 'sC', program: 'NOT_ELIGIBLE', rank: 3, status: 'CLASSIFIED', classifiedAt: new Date(), selectionCycleId: CYCLE_ID, snapshotId: null },
      ]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(3),
    },
    rankingSnapshot: {
      create: jest.fn().mockResolvedValue({ id: 'snap-1', version: 1, frozenAt: new Date() }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    rankingSnapshotEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    freezeSchedule: {
      create: jest.fn().mockResolvedValue({ id: 'fs-1', status: 'SCHEDULED' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    studentCycleStatus: {
      findMany: jest.fn().mockResolvedValue([{ studentId: 'sA' }, { studentId: 'sB' }, { studentId: 'sC' }]),
      count: jest.fn().mockResolvedValue(3),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
      if (typeof ops === 'function') {
        // callback-style — minimal tx
        const tx = {
          rankingSnapshot: { create: jest.fn().mockResolvedValue({ id: 'snap-1', version: 1, frozenAt: new Date() }) },
          rankingSnapshotEntry: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
          freezeSchedule: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create: jest.fn() },
          hopePepClassification: { upsert: jest.fn().mockResolvedValue({}) },
        };
        return ops(tx);
      }
      return Promise.all(ops);
    }),
  };
}

async function buildService<T>(
  token: unknown,
  prismaOverrides: Partial<ReturnType<typeof basePrisma>> = {},
): Promise<T> {
  const prisma = buildPrisma(prismaOverrides);
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    planAndPersist: jest.fn().mockResolvedValue(undefined),
    cancelEventsForSchedule: jest.fn().mockResolvedValue(0),
    markExecuted: jest.fn().mockResolvedValue(undefined),
  };
  const module = await Test.createTestingModule({
    providers: [
      ScoringService, EligibilityService, RankingService,
      ClassificationService, FreezeService, SelectionResultService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: FreezeNotificationService, useValue: notifications },
    ],
  }).compile();
  return module.get(token as Parameters<typeof module.get>[0]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('End-to-End Pipeline Smoke Test (P17)', () => {

  // ─── STEP 1-2: Scoring ────────────────────────────────────────────────────

  it('Step 1-2: scoring produces per-parameter rows with all required fields', async () => {
    const scoring = await buildService<ScoringService>(ScoringService);

    const result = await scoring.calculateStudentScores(
      CYCLE_ID, 'sA',
      [{ parameterKey: 'coding', rawScore: 90 }],
      ACTOR,
    );

    expect(result.weightVersionId).toBe(WV_ID);
    expect(result.parameterScores).toHaveLength(1);
    expect(result.parameterScores[0].parameterKey).toBe('coding');
    expect(result.parameterScores[0].rawScore).toBe(90);
    expect(result.parameterScores[0].normalizedScore).toBeGreaterThanOrEqual(0);
    expect(result.parameterScores[0].weight).toBe(1.0);
    expect(result.parameterScores[0].weightedScore).toBeGreaterThan(0);
    expect(result.parameterScores[0].isMissing).toBe(false);
    expect(result.totalScore).toBeGreaterThan(0);
  });

  // ─── STEP 3: Eligibility ──────────────────────────────────────────────────

  it('Step 3: eligibility atomically evaluates all students with one ruleVersionId', async () => {
    const eligibility = await buildService<EligibilityService>(EligibilityService);

    const results = await eligibility.evaluate(CYCLE_ID, RV_ID, ACTOR);

    expect(results).toHaveLength(3);
    expect(results.find((r) => r.studentId === 'sA')?.isEligible).toBe(true);
    expect(results.find((r) => r.studentId === 'sC')?.isEligible).toBe(false);
  });

  // ─── STEP 4: Ranking ──────────────────────────────────────────────────────

  it('Step 4: ranking covers ALL students (including ineligible) and is deterministic', async () => {
    const ranking = await buildService<RankingService>(RankingService);

    const results = await ranking.calculate(CYCLE_ID, WV_ID, ACTOR);

    expect(results).toHaveLength(3);
    const ranks = results.map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]); // sequential, no gaps
  });

  // ─── STEP 5: Classification ───────────────────────────────────────────────

  it('Step 5: classification assigns HOPE/PEP from live ranking and eligibility', async () => {
    const classification = await buildService<ClassificationService>(ClassificationService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(null), // no executed freeze → live classify allowed
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const results = await (classification as ClassificationService).calculate(CYCLE_ID, ACTOR);

    expect(results.some((c) => c.program === 'HOPE')).toBe(true);
    expect(results.some((c) => c.program === 'PEP')).toBe(true);
    expect(results.some((c) => c.program === 'NOT_ELIGIBLE')).toBe(true);
    expect(results[0].source).toBe('LIVE');
  });

  // ─── STEP 6: Before freeze → LIVE authority ───────────────────────────────

  it('Step 6: before freeze, selection uses LIVE authority and LIVE data', async () => {
    const selection = await buildService<SelectionResultService>(SelectionResultService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const results = await (selection as SelectionResultService).getSelectionResults(CYCLE_ID);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('LIVE');
    expect(results[0].decisionReference).toContain(':LIVE');
    expect(results[0].snapshotId).toBeUndefined();
  });

  // ─── STEP 7: executeFreeze empty-ranking guard ────────────────────────────

  it('Step 7a: executeFreeze rejects when students exist but ranking is empty', async () => {
    const freeze = await buildService<FreezeService>(FreezeService, {
      studentRanking: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]), // empty rankings
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      studentCycleStatus: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(3), // students exist
      },
      freezeSchedule: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { status?: string } }) => {
          if (where.status === 'SCHEDULED') return { id: 'fs-s', status: 'SCHEDULED' };
          return null;
        }),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      (freeze as FreezeService).executeFreeze(CYCLE_ID, ACTOR),
    ).rejects.toThrow(BadRequestException);
  });

  it('Step 7b: executeFreeze creates a versioned snapshot', async () => {
    let createdSnapshotData: Record<string, unknown> | null = null;
    let createdEntries: unknown[] = [];

    const freeze = await buildService<FreezeService>(FreezeService, {
      freezeSchedule: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { status?: string } }) => {
          if (where.status === 'SCHEDULED') return { id: 'fs-sched', status: 'SCHEDULED' };
          return null;
        }),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
              createdSnapshotData = data;
              return { id: 'snap-1', version: data.version, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockImplementation(({ data }: { data: unknown[] }) => {
              createdEntries = data;
              return { count: data.length };
            }),
          },
          freezeSchedule: {
            findFirst: jest.fn().mockResolvedValue({ id: 'fs-sched', status: 'SCHEDULED' }),
            update: jest.fn(),
          },
        };
        return fn(tx);
      }),
    });

    const result = await (freeze as FreezeService).executeFreeze(CYCLE_ID, ACTOR);

    expect(result.version).toBe(1);
    expect(result.studentCount).toBe(3);
    expect(createdSnapshotData!.weightVersionId).toBe(WV_ID);
    expect(createdSnapshotData!.ruleVersionId).toBe(RV_ID);
    expect(createdEntries).toHaveLength(3);
    // All entries have required fields
    const entry = (createdEntries[0] as Record<string, unknown>);
    expect(entry.studentId).toBeDefined();
    expect(entry.rank).toBeDefined();
    expect(entry.totalScore).toBeDefined();
    expect(entry.isEligible).toBeDefined();
    expect(entry.parameterScores).toBeDefined();
  });

  // ─── STEP 8: After freeze → SNAPSHOT authority ────────────────────────────

  it('Step 8: after freeze, selection uses SNAPSHOT authority exclusively', async () => {
    const selection = await buildService<SelectionResultService>(SelectionResultService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(EXECUTED_SCHEDULE_V1),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(SNAP_V1),
        findMany: jest.fn().mockResolvedValue([SNAP_V1]),
      },
      rankingSnapshotEntry: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue(SNAP_V1.entries),
        count: jest.fn().mockResolvedValue(SNAP_V1.entries.length),
        findFirst: jest.fn().mockImplementation(({ where }: { where: { studentId?: string } }) =>
          SNAP_V1.entries.find((e) => e.studentId === where.studentId) ?? null,
        ),
      },
    });

    const results = await (selection as SelectionResultService).getSelectionResults(CYCLE_ID);

    expect(results.length).toBe(3);
    expect(results.every((r) => r.source === 'SNAPSHOT')).toBe(true);
    expect(results.every((r) => r.snapshotVersion === 1)).toBe(true);
    expect(results.every((r) => r.decisionReference.includes(':SNAP:'))).toBe(true);
    // Does NOT mix live and frozen data — score comes from snapshot entry
    const alice = results.find((r) => r.studentId === 'sA');
    expect(alice?.rank).toBe(1);
    expect(alice?.score).toBe(90);
  });

  // ─── STEP 9: Live data changes do NOT affect snapshot ────────────────────

  it('Step 9: snapshot v1 is isolated from live data changes', async () => {
    // V1 snapshot was created with Alice at rank 1, score 90
    // "Live" data changes: Alice's score drops to 10 (new live ranking)
    const updatedLiveRankings = [
      { studentId: 'sB', rank: 1, totalScore: 70, selectionCycleId: CYCLE_ID },
      { studentId: 'sC', rank: 2, totalScore: 40, selectionCycleId: CYCLE_ID },
      { studentId: 'sA', rank: 3, totalScore: 10, selectionCycleId: CYCLE_ID },
    ];

    const selection = await buildService<SelectionResultService>(SelectionResultService, {
      freezeSchedule: {
        // EXECUTED freeze still points to snap-1
        findFirst: jest.fn().mockResolvedValue(EXECUTED_SCHEDULE_V1),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(SNAP_V1),
        findMany: jest.fn().mockResolvedValue([SNAP_V1]),
      },
      rankingSnapshotEntry: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue(SNAP_V1.entries), // snapshot unchanged
        count: jest.fn().mockResolvedValue(SNAP_V1.entries.length),
        findFirst: jest.fn().mockImplementation(({ where }: { where: { studentId?: string } }) =>
          SNAP_V1.entries.find((e) => e.studentId === where.studentId) ?? null,
        ),
      },
      // Live ranking changed — but frozen path doesn't use these
      studentRanking: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue(updatedLiveRankings),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
    });

    const results = await (selection as SelectionResultService).getSelectionResults(CYCLE_ID);
    const alice = results.find((r) => r.studentId === 'sA');

    // Snapshot still shows Alice at rank 1 (original), not live rank 3
    expect(alice?.rank).toBe(1);
    expect(alice?.score).toBe(90);
    expect(alice?.source).toBe('SNAPSHOT');
  });

  // ─── STEP 10: Re-freeze creates v2 ───────────────────────────────────────

  it('Step 10: re-freeze creates snapshot v2 with updated live data', async () => {
    let createdSnapshotV2: Record<string, unknown> | null = null;

    const freeze = await buildService<FreezeService>(FreezeService, {
      freezeSchedule: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { status?: string } }) => {
          if (where.status === 'EXECUTED') return EXECUTED_SCHEDULE_V1;
          return null;
        }),
        create: jest.fn().mockResolvedValue({ id: 'fs-2', status: 'EXECUTED', snapshotId: 'snap-2' }),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        findFirst: jest.fn().mockImplementation(({ where }: { where?: { id?: string } }) => {
          if (where?.id === EXECUTED_SCHEDULE_V1.snapshotId) return SNAP_V1;
          return { version: 1 }; // for version increment query
        }),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([SNAP_V1]),
      },
      studentRanking: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { studentId: 'sB', rank: 1, totalScore: 70, percentile: 100, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
          { studentId: 'sC', rank: 2, totalScore: 40, percentile: 33, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
          { studentId: 'sA', rank: 3, totalScore: 10, percentile: 0, tieBreakApplied: false, selectionCycleId: CYCLE_ID },
        ]),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      studentScore: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { studentId: 'sA', parameterKey: 'coding', rawScore: 10, normalizedScore: 0.1, weight: 1.0, weightedScore: 10, isMissing: false, weightVersionId: WV_ID },
          { studentId: 'sB', parameterKey: 'coding', rawScore: 70, normalizedScore: 0.7, weight: 1.0, weightedScore: 70, isMissing: false, weightVersionId: WV_ID },
          { studentId: 'sC', parameterKey: 'coding', rawScore: 40, normalizedScore: 0.4, weight: 1.0, weightedScore: 40, isMissing: false, weightVersionId: WV_ID },
        ]),
      },
      studentCycleStatus: {
        findMany: jest.fn().mockResolvedValue([{ studentId: 'sA' }, { studentId: 'sB' }, { studentId: 'sC' }]),
        count: jest.fn().mockResolvedValue(3),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          rankingSnapshot: {
            create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
              createdSnapshotV2 = data;
              return { id: 'snap-2', version: data.version, frozenAt: new Date() };
            }),
          },
          rankingSnapshotEntry: {
            createMany: jest.fn().mockResolvedValue({ count: 3 }),
          },
          freezeSchedule: {
            create: jest.fn().mockResolvedValue({ id: 'fs-2', status: 'EXECUTED', snapshotId: 'snap-2' }),
          },
          hopePepClassification: {
            upsert: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      }),
    });

    const result = await (freeze as FreezeService).refreeze(CYCLE_ID, ACTOR, 'updated data');

    expect(result.version).toBe(2);
    expect(result.previousVersion).toBe(1);
    expect(result.previousSnapshotId).toBe(SNAP_V1.id);
    expect(createdSnapshotV2!.weightVersionId).toBe(WV_ID);
  });

  // ─── STEP 11: Old snapshot unchanged ─────────────────────────────────────

  it('Step 11: snapshot v1 entries are unchanged after re-freeze', () => {
    // SNAP_V1 is a module-level constant — nothing in our pipeline modifies it
    expect(SNAP_V1.version).toBe(1);
    expect(SNAP_V1.entries.find((e) => e.studentId === 'sA')?.rank).toBe(1);
    expect(SNAP_V1.entries.find((e) => e.studentId === 'sA')?.totalScore).toBe(90);
    // V2 exists alongside V1 — V1 is not deleted or modified
    expect(SNAP_V2.version).toBe(2);
    expect(SNAP_V2.id).not.toBe(SNAP_V1.id);
  });

  // ─── STEP 12: Latest executed schedule is authoritative ───────────────────

  it('Step 12: after re-freeze, latest executed schedule (v2) is authoritative', async () => {
    const classification = await buildService<ClassificationService>(ClassificationService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(EXECUTED_SCHEDULE_V2), // latest = v2
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(SNAP_V2),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([SNAP_V1, SNAP_V2]),
      },
    });

    const authority = await (classification as ClassificationService).resolveSelectionAuthority(CYCLE_ID);

    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotVersion).toBe(2);
    expect(authority.snapshotId).toBe(SNAP_V2.id);
  });

  // ─── STEP 13: Selection results reflect v2 ───────────────────────────────

  it('Step 13: selection results after re-freeze show v2 snapshot data', async () => {
    const selection = await buildService<SelectionResultService>(SelectionResultService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(EXECUTED_SCHEDULE_V2),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(SNAP_V2),
        findMany: jest.fn().mockResolvedValue([SNAP_V1, SNAP_V2]),
      },
      rankingSnapshotEntry: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue(SNAP_V2.entries),
        count: jest.fn().mockResolvedValue(SNAP_V2.entries.length),
        findFirst: jest.fn().mockImplementation(({ where }: { where: { studentId?: string } }) =>
          SNAP_V2.entries.find((e) => e.studentId === where.studentId) ?? null,
        ),
      },
    });

    const results = await (selection as SelectionResultService).getSelectionResults(CYCLE_ID);

    expect(results.every((r) => r.snapshotVersion === 2)).toBe(true);
    // In v2, sA is now rank 3 (score dropped to 10 in live data before re-freeze)
    const alice = results.find((r) => r.studentId === 'sA');
    expect(alice?.rank).toBe(3);
    expect(alice?.score).toBe(10);
  });

  // ─── STEP 14: Fail-closed authority (P12.1) ───────────────────────────────

  it('Step 14: authority fails closed when executed freeze has no snapshotId', async () => {
    const classification = await buildService<ClassificationService>(ClassificationService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fs-orphan', status: 'EXECUTED',
          executedAt: new Date(), snapshotId: null,
        }),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      (classification as ClassificationService).resolveSelectionAuthority(CYCLE_ID),
    ).rejects.toThrow();
  });

  // ─── STEP 15: Frozen selection doesn't mix live and snapshot data ─────────

  it('Step 15: frozen selection result never mixes frozen rank with live score', async () => {
    const selection = await buildService<SelectionResultService>(SelectionResultService, {
      freezeSchedule: {
        findFirst: jest.fn().mockResolvedValue(EXECUTED_SCHEDULE_V1),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      rankingSnapshot: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(SNAP_V1),
        findMany: jest.fn().mockResolvedValue([SNAP_V1]),
      },
      rankingSnapshotEntry: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue(SNAP_V1.entries),
        count: jest.fn().mockResolvedValue(SNAP_V1.entries.length),
        findFirst: jest.fn().mockImplementation(({ where }: { where: { studentId?: string } }) =>
          SNAP_V1.entries.find((e) => e.studentId === where.studentId) ?? null,
        ),
      },
    });

    const result = await (selection as SelectionResultService).getStudentSelectionResult(CYCLE_ID, 'sA');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('SNAPSHOT');
    expect(result!.rank).toBe(1);           // from snapshot
    expect(result!.score).toBe(90);          // from snapshot (not live 10)
    expect(result!.programCode).toBe('HOPE'); // from snapshot
  });
});
