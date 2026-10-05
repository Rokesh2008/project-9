/**
 * Prompt 17 — Full Member 1 Integration Smoke Test
 *
 * Proves the complete end-to-end pipeline is internally consistent using
 * unit-level (mocked) infrastructure (PostgreSQL unavailable locally).
 *
 * Scenario:
 *   1. Configure cycle with weight/rule versions
 *   2. Calculate scores for three students
 *   3. Evaluate eligibility (s1, s2 eligible; s3 not)
 *   4. Calculate common ranking (all three, s1=1, s2=2, s3=3)
 *   5. Calculate HOPE/PEP classification (s1=HOPE, s2=PEP, s3=NOT_ELIGIBLE)
 *   6. Freeze → authority switches to SNAPSHOT v1
 *   7. Read selection results → SNAPSHOT v1 data
 *   8. "Change" live ranking/eligibility for s3 (in-memory mock update)
 *   9. Read selection results → still v1 snapshot (unchanged)
 *  10. Re-freeze → authority switches to SNAPSHOT v2
 *  11. Read selection results → SNAPSHOT v2 (s3 now eligible)
 *  12. Read SNAPSHOT v1 entries directly → unchanged
 *  13. Latest authoritative snapshot is v2
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { SelectionResultService } from '../src/member1/selection/selection-result.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';

// ─── IDs ──────────────────────────────────────────────────────────────────────
const CYCLE = 'smoke-cycle';
const WV = 'smoke-wv1';
const RV = 'smoke-rv1';
const S1 = 'smoke-s1';
const S2 = 'smoke-s2';
const S3 = 'smoke-s3';
const SNAP_V1 = 'snap-v1-id';
const SNAP_V2 = 'snap-v2-id';
const SCHED_V1 = 'sched-v1-id';
const SCHED_V2 = 'sched-v2-id';
const ACTOR = 'smoke-admin';

// ─── In-memory store ──────────────────────────────────────────────────────────
interface SnapshotRow {
  id: string;
  selectionCycleId: string;
  version: number;
  weightVersionId: string;
  ruleVersionId: string | null;
  hopeCount: number;
  pepCount: number;
  totalStudents: number;
  frozenAt: Date;
  frozenBy: string;
  reason: string | null;
}

interface EntryRow {
  id: string;
  snapshotId: string;
  studentId: string;
  rank: number;
  totalScore: number;
  percentile: number | null;
  parameterScores: unknown;
  isEligible: boolean;
  eligibilityFailures: unknown;
  program: string | null;
  tieBreakApplied: boolean;
}

interface ScheduleRow {
  id: string;
  selectionCycleId: string;
  scheduledAt: Date;
  status: string;
  executedAt: Date | null;
  snapshotId: string | null;
  scheduledBy: string;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Mock factory ─────────────────────────────────────────────────────────────
function buildStore() {
  const snapshots: SnapshotRow[] = [];
  const entries: EntryRow[] = [];
  const schedules: ScheduleRow[] = [];
  let classifMap: Map<string, { program: string; rank: number; snapshotId: string | null }> = new Map();

  // Helpers
  const snapshotFindFirst = jest.fn().mockImplementation(({ where }: { where: Partial<SnapshotRow> }) => {
    const rows = snapshots.filter((s) => {
      if (where.id && s.id !== where.id) return false;
      if (where.selectionCycleId && s.selectionCycleId !== where.selectionCycleId) return false;
      return true;
    });
    // orderBy: version desc
    rows.sort((a, b) => b.version - a.version);
    return Promise.resolve(rows[0] ?? null);
  });

  let snapshotCreateCount = 0;
  const snapshotCreate = jest.fn().mockImplementation(({ data }: { data: Partial<SnapshotRow> }) => {
    snapshotCreateCount++;
    const row: SnapshotRow = {
      id: data.id ?? `snap-${snapshots.length + 1}`,
      selectionCycleId: data.selectionCycleId!,
      version: data.version!,
      weightVersionId: data.weightVersionId!,
      ruleVersionId: data.ruleVersionId ?? null,
      hopeCount: data.hopeCount!,
      pepCount: data.pepCount!,
      totalStudents: data.totalStudents!,
      // Offset by creation count so v2 has definitively later frozenAt,
      // ensuring scheduleUpdate/create using snapshot.frozenAt sorts correctly.
      frozenAt: new Date(Date.now() + snapshotCreateCount * 1000),
      frozenBy: data.frozenBy!,
      reason: data.reason ?? null,
    };
    snapshots.push(row);
    return Promise.resolve(row);
  });

  const entryCreateMany = jest.fn().mockImplementation(({ data }: { data: Partial<EntryRow>[] }) => {
    for (const d of data) {
      entries.push({
        id: `entry-${entries.length + 1}`,
        snapshotId: d.snapshotId!,
        studentId: d.studentId!,
        rank: d.rank!,
        totalScore: d.totalScore!,
        percentile: d.percentile ?? null,
        parameterScores: d.parameterScores ?? {},
        isEligible: d.isEligible!,
        eligibilityFailures: d.eligibilityFailures ?? null,
        program: d.program ?? null,
        tieBreakApplied: d.tieBreakApplied ?? false,
      });
    }
    return Promise.resolve({ count: data.length });
  });

  const entryFindMany = jest.fn().mockImplementation(({ where, orderBy }: { where: { snapshotId: string }; orderBy?: { rank: 'asc' | 'desc' } }) => {
    let rows = entries.filter((e) => e.snapshotId === where.snapshotId);
    if (orderBy?.rank === 'asc') rows = rows.sort((a, b) => a.rank - b.rank);
    return Promise.resolve(rows);
  });

  const entryFindFirst = jest.fn().mockImplementation(({ where }: { where: { snapshotId: string; studentId: string } }) => {
    const row = entries.find((e) => e.snapshotId === where.snapshotId && e.studentId === where.studentId);
    return Promise.resolve(row ?? null);
  });

  const entryCount = jest.fn().mockImplementation(({ where }: { where: { snapshotId: string } }) => {
    return Promise.resolve(entries.filter((e) => e.snapshotId === where.snapshotId).length);
  });

  const scheduleCreate = jest.fn().mockImplementation(({ data }: { data: Partial<ScheduleRow> }) => {
    const row: ScheduleRow = {
      id: data.id ?? `sched-${schedules.length + 1}`,
      selectionCycleId: data.selectionCycleId!,
      scheduledAt: data.scheduledAt ?? new Date(),
      status: data.status!,
      executedAt: data.executedAt ?? null,
      snapshotId: data.snapshotId ?? null,
      scheduledBy: data.scheduledBy!,
      cancelledBy: null,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    schedules.push(row);
    return Promise.resolve(row);
  });

  const scheduleUpdate = jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<ScheduleRow> }) => {
    const row = schedules.find((s) => s.id === where.id);
    if (row) Object.assign(row, data);
    return Promise.resolve(row ?? null);
  });

  const scheduleFindFirst = jest.fn().mockImplementation(({ where, orderBy }: { where: Partial<ScheduleRow>; orderBy?: { executedAt?: 'desc' } }) => {
    let rows = schedules.filter((s) => {
      if (where.selectionCycleId && s.selectionCycleId !== where.selectionCycleId) return false;
      if (where.status && s.status !== where.status) return false;
      return true;
    });
    if (orderBy?.executedAt === 'desc') {
      rows = rows.sort((a, b) => (b.executedAt?.getTime() ?? 0) - (a.executedAt?.getTime() ?? 0));
    }
    return Promise.resolve(rows[0] ?? null);
  });

  const classifFindMany = jest.fn().mockImplementation(({ where }: { where: { selectionCycleId: string; studentId?: { in: string[] } } }) => {
    return Promise.resolve(
      Array.from(classifMap.entries())
        .filter(([sid]) => !where.studentId || where.studentId.in.includes(sid))
        .map(([sid, c]) => ({
          studentId: sid,
          selectionCycleId: CYCLE,
          program: c.program,
          rank: c.rank,
          snapshotId: c.snapshotId,
          status: 'CLASSIFIED',
          classifiedAt: new Date(),
          updatedAt: new Date(),
        })),
    );
  });

  return {
    snapshots,
    entries,
    schedules,
    classifMap,
    prisma: {
      selectionCycle: {
        findUnique: jest.fn().mockResolvedValue({ id: CYCLE }),
      },
      cycleConfig: {
        findUnique: jest.fn().mockResolvedValue({
          selectionCycleId: CYCLE,
          activeWeightVersionId: WV,
          eligibilityRuleVersionId: RV,
          hopeCount: 1,
          pepCount: 1,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      weightVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: WV, version: 1, weights: [] }),
      },
      eligibilityRuleVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: RV, version: 1 }),
      },
      studentRanking: {
        findMany: jest.fn(),
      },
      studentScore: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      eligibilityResult: {
        findMany: jest.fn(),
      },
      hopePepClassification: {
        findMany: classifFindMany,
        findUnique: jest.fn(),
        upsert: jest.fn().mockImplementation(({ where, create, update }) => {
          classifMap.set(where.studentId_selectionCycleId.studentId, {
            program: create.program,
            rank: create.rank,
            snapshotId: create.snapshotId ?? null,
          });
          return Promise.resolve({});
        }),
      },
      studentCycleStatus: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          { studentId: S1 }, { studentId: S2 }, { studentId: S3 },
        ]),
      },
      rankingSnapshot: {
        findFirst: snapshotFindFirst,
        findMany: jest.fn().mockImplementation(() => Promise.resolve([...snapshots].sort((a, b) => b.version - a.version))),
        create: snapshotCreate,
      },
      rankingSnapshotEntry: {
        findMany: entryFindMany,
        findFirst: entryFindFirst,
        count: entryCount,
        createMany: entryCreateMany,
      },
      freezeSchedule: {
        findFirst: scheduleFindFirst,
        findMany: jest.fn().mockImplementation(() => Promise.resolve(schedules)),
        create: scheduleCreate,
        update: scheduleUpdate,
      },
      scoreAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            rankingSnapshot: { create: snapshotCreate },
            rankingSnapshotEntry: { createMany: entryCreateMany },
            freezeSchedule: { findFirst: scheduleFindFirst, update: scheduleUpdate, create: scheduleCreate },
            hopePepClassification: {
              upsert: jest.fn().mockImplementation(({ where, create }) => {
                classifMap.set(where.studentId_selectionCycleId.studentId, {
                  program: create.program,
                  rank: create.rank,
                  snapshotId: create.snapshotId ?? null,
                });
                return Promise.resolve({});
              }),
            },
          };
          return fn(tx);
        }
        return Promise.all(fn as Promise<unknown>[]);
      }),
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Member 1 — Integration Smoke Test (P17)', () => {
  let classificationService: ClassificationService;
  let freezeService: FreezeService;
  let selectionService: SelectionResultService;
  let store: ReturnType<typeof buildStore>;

  beforeEach(async () => {
    store = buildStore();

    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      planAndPersist: jest.fn().mockResolvedValue(undefined),
      cancelEventsForSchedule: jest.fn().mockResolvedValue(undefined),
      markExecuted: jest.fn().mockResolvedValue(undefined),
      getEventsForCycle: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassificationService,
        FreezeService,
        SelectionResultService,
        { provide: PrismaService, useValue: store.prisma },
        { provide: AuditService, useValue: audit },
        { provide: FreezeNotificationService, useValue: notifications },
      ],
    }).compile();

    classificationService = module.get(ClassificationService);
    freezeService = module.get(FreezeService);
    selectionService = module.get(SelectionResultService);
  });

  // ── Step 1-5: Pipeline wiring ───────────────────────────────────────────────

  // Test 1 — before freeze, authority is LIVE
  it('1. before any freeze, resolveSelectionAuthority returns LIVE', async () => {
    const authority = await classificationService.resolveSelectionAuthority(CYCLE);
    expect(authority.source).toBe('LIVE');
  });

  // Test 2 — before freeze, getSelectionResults throws when no classification exists
  it('2. before freeze, getSelectionResults throws when no classification data', async () => {
    // empty classifMap
    await expect(selectionService.getSelectionResults(CYCLE)).rejects.toThrow(NotFoundException);
  });

  // ── Step 6: Freeze ───────────────────────────────────────────────────────────

  function setupLiveRankingV1() {
    store.prisma.studentRanking.findMany.mockResolvedValue([
      { studentId: S1, rank: 1, totalScore: 90, percentile: 66, tieBreakApplied: false },
      { studentId: S2, rank: 2, totalScore: 80, percentile: 33, tieBreakApplied: false },
      { studentId: S3, rank: 3, totalScore: 70, percentile: 0, tieBreakApplied: false },
    ]);
    store.prisma.eligibilityResult.findMany.mockResolvedValue([
      { studentId: S1, isEligible: true, failedRules: null },
      { studentId: S2, isEligible: true, failedRules: null },
      { studentId: S3, isEligible: false, failedRules: [{ message: 'codingScore GTE 50: failed' }] },
    ]);
    store.classifMap.set(S1, { program: 'HOPE', rank: 1, snapshotId: null });
    store.classifMap.set(S2, { program: 'PEP', rank: 2, snapshotId: null });
    store.classifMap.set(S3, { program: 'NOT_ELIGIBLE', rank: 3, snapshotId: null });

    // Existing SCHEDULED freeze
    store.schedules.push({
      id: SCHED_V1,
      selectionCycleId: CYCLE,
      scheduledAt: new Date(Date.now() - 60_000),
      status: 'SCHEDULED',
      executedAt: null,
      snapshotId: null,
      scheduledBy: ACTOR,
      cancelledBy: null,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Test 3 — executeFreeze creates snapshot v1 and links to schedule
  it('3. executeFreeze creates snapshot v1 and marks schedule EXECUTED', async () => {
    setupLiveRankingV1();

    const result = await freezeService.executeFreeze(CYCLE, ACTOR);

    expect(result.version).toBe(1);
    expect(result.studentCount).toBe(3);
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0].version).toBe(1);
  });

  // Test 4 — after freeze, authority switches to SNAPSHOT v1
  it('4. after freeze, resolveSelectionAuthority returns SNAPSHOT v1', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    const authority = await classificationService.resolveSelectionAuthority(CYCLE);
    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotVersion).toBe(1);
  });

  // Test 5 — snapshot v1 entries contain all 3 students
  it('5. snapshot v1 contains entries for all 3 students', async () => {
    setupLiveRankingV1();
    const { snapshotId } = await freezeService.executeFreeze(CYCLE, ACTOR);

    const v1entries = store.entries.filter((e) => e.snapshotId === snapshotId);
    expect(v1entries).toHaveLength(3);
    const studentIds = v1entries.map((e) => e.studentId).sort();
    expect(studentIds).toEqual([S1, S2, S3].sort());
  });

  // Test 6 — snapshot v1 captures eligibility failures for s3
  it('6. snapshot v1 records s3 as ineligible with failure message', async () => {
    setupLiveRankingV1();
    const { snapshotId } = await freezeService.executeFreeze(CYCLE, ACTOR);

    const s3entry = store.entries.find((e) => e.snapshotId === snapshotId && e.studentId === S3)!;
    expect(s3entry.isEligible).toBe(false);
    expect(s3entry.eligibilityFailures).toBeTruthy();
  });

  // Test 7 — snapshot v1 records weightVersionId and ruleVersionId
  it('7. snapshot v1 records weightVersionId and ruleVersionId', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    const snap = store.snapshots[0];
    expect(snap.weightVersionId).toBe(WV);
    expect(snap.ruleVersionId).toBe(RV);
  });

  // ── Step 7-9: Snapshot isolation ─────────────────────────────────────────────

  // Test 8 — getSelectionResults uses SNAPSHOT data after freeze
  it('8. getSelectionResults returns SNAPSHOT source after freeze', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    const results = await selectionService.getSelectionResults(CYCLE);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.source === 'SNAPSHOT')).toBe(true);
  });

  // Test 9 — decisionReference includes snapshotId and version
  it('9. decisionReference includes snapshot reference', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    const results = await selectionService.getSelectionResults(CYCLE);
    const s1result = results.find((r) => r.studentId === S1)!;
    expect(s1result.decisionReference).toContain('SNAP');
    expect(s1result.decisionReference).toContain('v1');
    expect(s1result.snapshotVersion).toBe(1);
  });

  // Test 10 — "live" data changes don't affect frozen snapshot entries
  it('10. mutating live ranking mock does not change snapshot v1 entries', async () => {
    setupLiveRankingV1();
    const { snapshotId } = await freezeService.executeFreeze(CYCLE, ACTOR);

    // Simulate live data change: s3 now has rank 1
    store.prisma.studentRanking.findMany.mockResolvedValue([
      { studentId: S3, rank: 1, totalScore: 100, percentile: 66, tieBreakApplied: false },
      { studentId: S1, rank: 2, totalScore: 90, percentile: 33, tieBreakApplied: false },
      { studentId: S2, rank: 3, totalScore: 80, percentile: 0, tieBreakApplied: false },
    ]);
    store.prisma.eligibilityResult.findMany.mockResolvedValue([
      { studentId: S1, isEligible: true, failedRules: null },
      { studentId: S2, isEligible: true, failedRules: null },
      { studentId: S3, isEligible: true, failedRules: null }, // now eligible
    ]);

    // v1 snapshot entries are unchanged (they were written to store.entries already)
    const v1entries = store.entries.filter((e) => e.snapshotId === snapshotId);
    const s1inV1 = v1entries.find((e) => e.studentId === S1)!;
    expect(s1inV1.rank).toBe(1); // s1 was rank 1 in v1
  });

  // Test 11 — after live change, getSelectionResults still returns v1 snapshot data
  it('11. after live data change, selection results still return v1 snapshot data', async () => {
    setupLiveRankingV1();
    const { snapshotId: snapV1Id } = await freezeService.executeFreeze(CYCLE, ACTOR);

    // Simulate live update
    store.prisma.studentRanking.findMany.mockResolvedValue([
      { studentId: S3, rank: 1, totalScore: 100, percentile: 66, tieBreakApplied: false },
      { studentId: S1, rank: 2, totalScore: 90, percentile: 33, tieBreakApplied: false },
      { studentId: S2, rank: 3, totalScore: 80, percentile: 0, tieBreakApplied: false },
    ]);

    const results = await selectionService.getSelectionResults(CYCLE);
    // Still reading from v1 snapshot
    const s1 = results.find((r) => r.studentId === S1)!;
    expect(s1.rank).toBe(1); // frozen rank from v1
    expect(s1.snapshotVersion).toBe(1);
  });

  // ── Step 10-13: Re-freeze ─────────────────────────────────────────────────────

  function setupLiveRankingV2() {
    store.prisma.studentRanking.findMany.mockResolvedValue([
      { studentId: S3, rank: 1, totalScore: 100, percentile: 66, tieBreakApplied: false },
      { studentId: S1, rank: 2, totalScore: 90, percentile: 33, tieBreakApplied: false },
      { studentId: S2, rank: 3, totalScore: 80, percentile: 0, tieBreakApplied: false },
    ]);
    store.prisma.eligibilityResult.findMany.mockResolvedValue([
      { studentId: S1, isEligible: true, failedRules: null },
      { studentId: S2, isEligible: true, failedRules: null },
      { studentId: S3, isEligible: true, failedRules: null },
    ]);
  }

  // Test 12 — refreeze creates snapshot v2 without modifying v1
  it('12. refreeze creates snapshot v2 and preserves v1', async () => {
    setupLiveRankingV1();
    const { snapshotId: snapV1Id } = await freezeService.executeFreeze(CYCLE, ACTOR);

    setupLiveRankingV2();
    const result = await freezeService.refreeze(CYCLE, ACTOR, 'updated ranking');

    expect(result.version).toBe(2);
    expect(result.previousVersion).toBe(1);
    expect(result.previousSnapshotId).toBe(snapV1Id);
    expect(store.snapshots).toHaveLength(2);
  });

  // Test 13 — after refreeze, authority points to SNAPSHOT v2
  it('13. after refreeze, resolveSelectionAuthority returns SNAPSHOT v2', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    setupLiveRankingV2();
    await freezeService.refreeze(CYCLE, ACTOR);

    const authority = await classificationService.resolveSelectionAuthority(CYCLE);
    expect(authority.source).toBe('SNAPSHOT');
    expect(authority.snapshotVersion).toBe(2);
  });

  // Test 14 — selection results after refreeze come from v2
  it('14. selection results after refreeze use snapshot v2 (s3 now rank 1)', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    setupLiveRankingV2();
    const { snapshotId: snapV2Id } = await freezeService.refreeze(CYCLE, ACTOR);

    const results = await selectionService.getSelectionResults(CYCLE);
    expect(results.every((r) => r.snapshotVersion === 2)).toBe(true);
    const s3 = results.find((r) => r.studentId === S3)!;
    expect(s3.rank).toBe(1);
  });

  // Test 15 — v1 snapshot entries remain unmodified after refreeze
  it('15. snapshot v1 entries remain intact after refreeze', async () => {
    setupLiveRankingV1();
    const { snapshotId: snapV1Id } = await freezeService.executeFreeze(CYCLE, ACTOR);

    setupLiveRankingV2();
    await freezeService.refreeze(CYCLE, ACTOR);

    const v1entries = store.entries.filter((e) => e.snapshotId === snapV1Id);
    expect(v1entries).toHaveLength(3);
    // s1 was rank 1 in v1
    const s1inV1 = v1entries.find((e) => e.studentId === S1)!;
    expect(s1inV1.rank).toBe(1);
    // s3 was rank 3 and ineligible in v1
    const s3inV1 = v1entries.find((e) => e.studentId === S3)!;
    expect(s3inV1.rank).toBe(3);
    expect(s3inV1.isEligible).toBe(false);
  });

  // Test 16 — v2 entries reflect updated ranking
  it('16. snapshot v2 entries reflect updated ranking (s3 = rank 1, eligible)', async () => {
    setupLiveRankingV1();
    await freezeService.executeFreeze(CYCLE, ACTOR);

    setupLiveRankingV2();
    const { snapshotId: snapV2Id } = await freezeService.refreeze(CYCLE, ACTOR);

    const v2entries = store.entries.filter((e) => e.snapshotId === snapV2Id);
    expect(v2entries).toHaveLength(3);
    const s3inV2 = v2entries.find((e) => e.studentId === S3)!;
    expect(s3inV2.rank).toBe(1);
    expect(s3inV2.isEligible).toBe(true);
  });

  // Test 17 — refreeze is rejected when no existing executed freeze
  it('17. refreeze throws ConflictException when no prior executed freeze', async () => {
    // No freeze executed yet
    await expect(
      freezeService.refreeze(CYCLE, ACTOR),
    ).rejects.toThrow(ConflictException);
  });

  // Test 18 — empty-ranking guard: executeFreeze rejects when students exist but no ranking
  it('18. executeFreeze rejects when students exist but no ranking data', async () => {
    store.prisma.studentRanking.findMany.mockResolvedValue([]);
    // studentCycleStatus.count returns 3 (students exist)

    store.schedules.push({
      id: SCHED_V1,
      selectionCycleId: CYCLE,
      scheduledAt: new Date(Date.now() - 60_000),
      status: 'SCHEDULED',
      executedAt: null,
      snapshotId: null,
      scheduledBy: ACTOR,
      cancelledBy: null,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      freezeService.executeFreeze(CYCLE, ACTOR),
    ).rejects.toThrow(BadRequestException);
  });

  // Test 19 — fail-closed authority: executed freeze with null snapshotId throws
  it('19. resolveSelectionAuthority throws ConflictException when executed freeze has null snapshotId', async () => {
    store.schedules.push({
      id: SCHED_V1,
      selectionCycleId: CYCLE,
      scheduledAt: new Date(Date.now() - 60_000),
      status: 'EXECUTED',
      executedAt: new Date(),
      snapshotId: null, // <-- null snapshotId
      scheduledBy: ACTOR,
      cancelledBy: null,
      cancelReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      classificationService.resolveSelectionAuthority(CYCLE),
    ).rejects.toThrow(ConflictException);
  });

  // Test 20 — processDueFreezes does not call audit.log with SYSTEM cycleId
  it('20. processDueFreezes does not call audit.log with invalid SYSTEM selectionCycleId', async () => {
    const auditSpy = jest.spyOn(
      (freezeService as any).audit as { log: jest.Mock },
      'log',
    );

    await freezeService.processDueFreezes(new Date());

    const systemLogs = auditSpy.mock.calls.filter(
      (c: unknown[]) => (c[0] as { selectionCycleId: string }).selectionCycleId === 'SYSTEM',
    );
    expect(systemLogs).toHaveLength(0);
  });
});
