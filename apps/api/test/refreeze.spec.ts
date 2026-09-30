import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FreezeService } from '../src/member1/freeze/freeze.service';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { SelectionResultService } from '../src/member1/selection/selection-result.service';
import { FreezeNotificationService } from '../src/member1/freeze/freeze-notification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

// ──────────────────────────────────────────
// Shared constants
// ──────────────────────────────────────────

const CYCLE_ID = 'cycle-001';
const SNAP_V1_ID = 'snap-v1';
const SNAP_V2_ID = 'snap-v2';
const SNAP_V3_ID = 'snap-v3';
const FROZEN_AT_V1 = new Date('2026-10-01T08:00:00Z');
const FROZEN_AT_V2 = new Date('2026-10-03T10:00:00Z');
const FROZEN_AT_V3 = new Date('2026-10-05T12:00:00Z');

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockNotifications = {
  planAndPersist: jest.fn().mockResolvedValue(undefined),
  cancelEventsForSchedule: jest.fn().mockResolvedValue(0),
  markExecuted: jest.fn().mockResolvedValue(undefined),
  getEventsForCycle: jest.fn().mockResolvedValue([]),
};

// ──────────────────────────────────────────
// Mock factory
// ──────────────────────────────────────────

function createMockPrisma() {
  return {
    selectionCycle: { findUnique: jest.fn() },
    studentCycleStatus: { count: jest.fn() },
    freezeSchedule: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    cycleConfig: { findUnique: jest.fn() },
    weightVersion: { findUnique: jest.fn() },
    eligibilityRuleVersion: { findUnique: jest.fn() },
    studentRanking: { findMany: jest.fn() },
    studentScore: { findMany: jest.fn() },
    eligibilityResult: { findMany: jest.fn() },
    hopePepClassification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    rankingSnapshot: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    rankingSnapshotEntry: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

// ──────────────────────────────────────────
// Standard live-state helpers
// ──────────────────────────────────────────

function buildRankings() {
  return [
    { studentId: 's1', rank: 1, totalScore: 90, percentile: 100, tieBreakApplied: false },
    { studentId: 's2', rank: 2, totalScore: 75, percentile: 60, tieBreakApplied: false },
    { studentId: 's3', rank: 3, totalScore: 60, percentile: 30, tieBreakApplied: false },
  ];
}

function buildScores() {
  return [
    { studentId: 's1', parameterKey: 'coding', rawScore: 95, normalizedScore: 0.95, weight: 0.5, weightedScore: 47.5, isMissing: false },
    { studentId: 's2', parameterKey: 'coding', rawScore: 75, normalizedScore: 0.75, weight: 0.5, weightedScore: 37.5, isMissing: false },
    { studentId: 's3', parameterKey: 'coding', rawScore: 60, normalizedScore: 0.6, weight: 0.5, weightedScore: 30, isMissing: false },
  ];
}

function buildEligibility() {
  return [
    { studentId: 's1', isEligible: true, failedRules: null },
    { studentId: 's2', isEligible: true, failedRules: null },
    { studentId: 's3', isEligible: false, failedRules: [{ message: 'GPA too low' }] },
  ];
}

// ──────────────────────────────────────────
// Transaction mock builder
// ──────────────────────────────────────────

function buildTransactionMock(
  prisma: ReturnType<typeof createMockPrisma>,
  newSnapId: string,
  newVersion: number,
  frozenAt: Date,
) {
  const txSnapshotCreate = jest.fn().mockResolvedValue({
    id: newSnapId,
    version: newVersion,
    frozenAt,
    selectionCycleId: CYCLE_ID,
    hopeCount: 1,
    pepCount: 1,
    totalStudents: 3,
  });
  const txEntryCreateMany = jest.fn().mockResolvedValue({ count: 3 });
  const txScheduleCreate = jest.fn().mockResolvedValue({ id: `fs-refreeze-${newVersion}` });
  const txClassificationUpsert = jest.fn().mockResolvedValue({});

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        rankingSnapshot: { create: txSnapshotCreate },
        rankingSnapshotEntry: { createMany: txEntryCreateMany },
        freezeSchedule: { create: txScheduleCreate },
        hopePepClassification: { upsert: txClassificationUpsert },
      };
      return fn(tx);
    },
  );

  return { txSnapshotCreate, txEntryCreateMany, txScheduleCreate, txClassificationUpsert };
}

// ──────────────────────────────────────────
// Full setup for a successful refreeze
// ──────────────────────────────────────────

function setupSuccessfulRefreeze(
  prisma: ReturnType<typeof createMockPrisma>,
  opts: {
    currentVersion?: number;
    nextSnapId?: string;
    nextVersion?: number;
    frozenAt?: Date;
  } = {},
) {
  const currentVersion = opts.currentVersion ?? 1;
  const nextVersion = opts.nextVersion ?? currentVersion + 1;
  const nextSnapId = opts.nextSnapId ?? SNAP_V2_ID;
  const frozenAt = opts.frozenAt ?? FROZEN_AT_V2;

  prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });

  prisma.freezeSchedule.findFirst.mockResolvedValue({
    id: 'fs-executed',
    status: 'EXECUTED',
    snapshotId: SNAP_V1_ID,
    executedAt: FROZEN_AT_V1,
    selectionCycleId: CYCLE_ID,
  });

  prisma.rankingSnapshot.findFirst
    // First call: currentSnapshot lookup by id
    .mockResolvedValueOnce({
      id: SNAP_V1_ID,
      version: currentVersion,
      frozenAt: FROZEN_AT_V1,
      selectionCycleId: CYCLE_ID,
    })
    // Second call: latestSnapshot for version incrementing
    .mockResolvedValueOnce({ version: currentVersion });

  prisma.cycleConfig.findUnique.mockResolvedValue({
    selectionCycleId: CYCLE_ID,
    activeWeightVersionId: 'wv-1',
    eligibilityRuleVersionId: 'rv-1',
    hopeCount: 1,
    pepCount: 1,
  });

  prisma.weightVersion.findUnique.mockResolvedValue({
    id: 'wv-1',
    version: 1,
    weights: [{ parameterKey: 'coding', weight: 0.5 }],
  });

  prisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
    id: 'rv-1',
    version: 1,
  });

  prisma.studentRanking.findMany.mockResolvedValue(buildRankings());
  prisma.studentScore.findMany.mockResolvedValue(buildScores());
  prisma.eligibilityResult.findMany.mockResolvedValue(buildEligibility());

  return buildTransactionMock(prisma, nextSnapId, nextVersion, frozenAt);
}

// ──────────────────────────────────────────
// FreezeService — refreeze
// ──────────────────────────────────────────

describe('FreezeService.refreeze', () => {
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
    mockAudit.log.mockResolvedValue(undefined);
  });

  // ─────────────────────────────────────
  // Pre-condition validation
  // ─────────────────────────────────────

  describe('pre-condition validation', () => {
    it('rejects if selection cycle not found', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects if no executed freeze exists', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects if executed freeze has no snapshotId', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: null,
      });

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects if authoritative snapshot record is missing', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: 'ghost-snap',
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects if no active weight version', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: null,
        hopeCount: 1,
        pepCount: 1,
      });

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─────────────────────────────────────
  // Versioning
  // ─────────────────────────────────────

  describe('versioning', () => {
    it('creates version 2 after version 1', async () => {
      const { txSnapshotCreate } = setupSuccessfulRefreeze(prisma, {
        currentVersion: 1,
        nextVersion: 2,
        nextSnapId: SNAP_V2_ID,
      });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.version).toBe(2);
      expect(txSnapshotCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
    });

    it('creates version 3 after version 2', async () => {
      const { txSnapshotCreate } = setupSuccessfulRefreeze(prisma, {
        currentVersion: 2,
        nextVersion: 3,
        nextSnapId: SNAP_V3_ID,
        frozenAt: FROZEN_AT_V3,
      });
      // Update first call to return v2 snapshot
      prisma.rankingSnapshot.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: SNAP_V2_ID, version: 2, frozenAt: FROZEN_AT_V2 })
        .mockResolvedValueOnce({ version: 2 });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-2',
        status: 'EXECUTED',
        snapshotId: SNAP_V2_ID,
        executedAt: FROZEN_AT_V2,
      });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.version).toBe(3);
      expect(txSnapshotCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 3 }) }),
      );
    });

    it('monotonically increments: result.version = previousVersion + 1', async () => {
      setupSuccessfulRefreeze(prisma, { currentVersion: 5, nextVersion: 6 });
      prisma.rankingSnapshot.findFirst
        .mockReset()
        .mockResolvedValueOnce({ id: SNAP_V1_ID, version: 5, frozenAt: FROZEN_AT_V1 })
        .mockResolvedValueOnce({ version: 5 });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.version).toBe(result.previousVersion + 1);
    });
  });

  // ─────────────────────────────────────
  // Snapshot immutability
  // ─────────────────────────────────────

  describe('snapshot immutability', () => {
    it('does not call update on the previous snapshot', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    });

    it('new snapshot has a different ID from previous', async () => {
      setupSuccessfulRefreeze(prisma, { nextSnapId: SNAP_V2_ID });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.snapshotId).toBe(SNAP_V2_ID);
      expect(result.previousSnapshotId).toBe(SNAP_V1_ID);
      expect(result.snapshotId).not.toBe(result.previousSnapshotId);
    });

    it('previous snapshot info is returned for audit reference', async () => {
      setupSuccessfulRefreeze(prisma, { currentVersion: 1, nextVersion: 2 });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.previousSnapshotId).toBe(SNAP_V1_ID);
      expect(result.previousVersion).toBe(1);
    });
  });

  // ─────────────────────────────────────
  // Live state capture
  // ─────────────────────────────────────

  describe('live state capture', () => {
    it('reads current live StudentRanking', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.studentRanking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { selectionCycleId: CYCLE_ID } }),
      );
    });

    it('reads current live StudentScore', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.studentScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ selectionCycleId: CYCLE_ID }) }),
      );
    });

    it('reads current live EligibilityResult', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.eligibilityResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ selectionCycleId: CYCLE_ID }) }),
      );
    });

    it('new snapshot totalStudents reflects current ranking count', async () => {
      const { txSnapshotCreate } = setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(txSnapshotCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalStudents: 3 }),
        }),
      );
    });

    it('new snapshot entries contain current score details', async () => {
      const { txEntryCreateMany } = setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      const callArg = txEntryCreateMany.mock.calls[0][0];
      expect(callArg.data.length).toBe(3);
      const s1Entry = callArg.data.find((e: { studentId: string }) => e.studentId === 's1');
      expect(s1Entry.parameterScores).toBeDefined();
      expect(s1Entry.rank).toBe(1);
      expect(s1Entry.totalScore).toBe(90);
    });

    it('new snapshot entries contain current eligibility state', async () => {
      const { txEntryCreateMany } = setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      const callArg = txEntryCreateMany.mock.calls[0][0];
      const s1Entry = callArg.data.find((e: { studentId: string }) => e.studentId === 's1');
      const s3Entry = callArg.data.find((e: { studentId: string }) => e.studentId === 's3');
      expect(s1Entry.isEligible).toBe(true);
      expect(s3Entry.isEligible).toBe(false);
    });
  });

  // ─────────────────────────────────────
  // Classification (HOPE/PEP counts)
  // ─────────────────────────────────────

  describe('classification', () => {
    it('new snapshot uses hopeCount from classification result', async () => {
      const { txSnapshotCreate } = setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      const snapData = txSnapshotCreate.mock.calls[0][0].data;
      // CycleConfig: hopeCount=1, pepCount=1
      // s1 eligible→HOPE, s2 eligible→PEP, s3 not eligible→NOT_ELIGIBLE
      expect(snapData.hopeCount).toBe(1);
      expect(snapData.pepCount).toBe(1);
    });

    it('snapshot entries carry the re-classified program', async () => {
      const { txEntryCreateMany } = setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      const entries = txEntryCreateMany.mock.calls[0][0].data;
      const s1Entry = entries.find((e: { studentId: string }) => e.studentId === 's1');
      const s3Entry = entries.find((e: { studentId: string }) => e.studentId === 's3');
      expect(s1Entry.program).toBe('HOPE');
      expect(s3Entry.program).toBe('NOT_ELIGIBLE');
    });

    it('HopePepClassification is upserted to point to new snapshot', async () => {
      const { txClassificationUpsert } = setupSuccessfulRefreeze(prisma, {
        nextSnapId: SNAP_V2_ID,
      });

      await service.refreeze(CYCLE_ID, 'admin');

      expect(txClassificationUpsert).toHaveBeenCalled();
      const firstCall = txClassificationUpsert.mock.calls[0][0];
      expect(firstCall.update.snapshotId).toBe(SNAP_V2_ID);
    });

    it('frozen classification does not query HopePepClassification live table', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.hopePepClassification.findMany).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────
  // Authority after re-freeze
  // ─────────────────────────────────────

  describe('authority after re-freeze', () => {
    it('creates new EXECUTED FreezeSchedule pointing to new snapshot', async () => {
      const { txScheduleCreate } = setupSuccessfulRefreeze(prisma, {
        nextSnapId: SNAP_V2_ID,
        nextVersion: 2,
      });

      await service.refreeze(CYCLE_ID, 'admin');

      expect(txScheduleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'EXECUTED',
            snapshotId: SNAP_V2_ID,
            selectionCycleId: CYCLE_ID,
          }),
        }),
      );
    });

    it('new EXECUTED schedule has executedAt set', async () => {
      const { txScheduleCreate } = setupSuccessfulRefreeze(prisma, {
        frozenAt: FROZEN_AT_V2,
      });

      await service.refreeze(CYCLE_ID, 'admin');

      const scheduleData = txScheduleCreate.mock.calls[0][0].data;
      expect(scheduleData.executedAt).toEqual(FROZEN_AT_V2);
    });

    it('does not modify the old EXECUTED schedule', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin');

      expect(prisma.freezeSchedule.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────
  // Authority resolution (ClassificationService)
  // ─────────────────────────────────────

  describe('authority resolution via ClassificationService', () => {
    let classService: ClassificationService;
    let classPrisma: ReturnType<typeof createMockPrisma>;

    beforeEach(async () => {
      classPrisma = createMockPrisma();
      const module = await Test.createTestingModule({
        providers: [
          ClassificationService,
          { provide: PrismaService, useValue: classPrisma },
          { provide: AuditService, useValue: mockAudit },
        ],
      }).compile();
      classService = module.get(ClassificationService);
    });

    it('resolveSelectionAuthority returns v2 snapshot after re-freeze to v2', async () => {
      // After re-freeze: two EXECUTED schedules exist; findFirst with executedAt desc returns the newer one
      classPrisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-refreeze',
        status: 'EXECUTED',
        snapshotId: SNAP_V2_ID,
        executedAt: FROZEN_AT_V2,
      });
      classPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V2_ID,
        version: 2,
        frozenAt: FROZEN_AT_V2,
      });

      const authority = await classService.resolveSelectionAuthority(CYCLE_ID);

      expect(authority.source).toBe('SNAPSHOT');
      expect(authority.snapshotId).toBe(SNAP_V2_ID);
      expect(authority.snapshotVersion).toBe(2);
    });

    it('resolveSelectionAuthority returns v3 snapshot after re-freeze to v3', async () => {
      classPrisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-refreeze-v3',
        status: 'EXECUTED',
        snapshotId: SNAP_V3_ID,
        executedAt: FROZEN_AT_V3,
      });
      classPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V3_ID,
        version: 3,
        frozenAt: FROZEN_AT_V3,
      });

      const authority = await classService.resolveSelectionAuthority(CYCLE_ID);

      expect(authority.source).toBe('SNAPSHOT');
      expect(authority.snapshotId).toBe(SNAP_V3_ID);
      expect(authority.snapshotVersion).toBe(3);
    });

    it('authority never silently falls back to LIVE when an executed freeze exists', async () => {
      classPrisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAP_V2_ID,
        executedAt: FROZEN_AT_V2,
      });
      classPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V2_ID,
        version: 2,
        frozenAt: FROZEN_AT_V2,
      });

      const authority = await classService.resolveSelectionAuthority(CYCLE_ID);

      expect(authority.source).toBe('SNAPSHOT');
      expect(authority.source).not.toBe('LIVE');
    });
  });

  // ─────────────────────────────────────
  // SelectionResultService after re-freeze
  // ─────────────────────────────────────

  describe('SelectionResultService after re-freeze', () => {
    let selResultService: SelectionResultService;
    let srPrisma: ReturnType<typeof createMockPrisma>;
    let mockClassSvc: { resolveSelectionAuthority: jest.Mock };

    beforeEach(async () => {
      srPrisma = createMockPrisma();
      mockClassSvc = { resolveSelectionAuthority: jest.fn() };
      const module = await Test.createTestingModule({
        providers: [
          SelectionResultService,
          { provide: PrismaService, useValue: srPrisma },
          { provide: ClassificationService, useValue: mockClassSvc },
        ],
      }).compile();
      selResultService = module.get(SelectionResultService);
    });

    it('returns v2 results after re-freeze to v2', async () => {
      srPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockClassSvc.resolveSelectionAuthority.mockResolvedValue({
        source: 'SNAPSHOT',
        snapshotId: SNAP_V2_ID,
        snapshotVersion: 2,
      });
      srPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V2_ID,
        version: 2,
        frozenAt: FROZEN_AT_V2,
        totalStudents: 1,
      });
      srPrisma.rankingSnapshotEntry.findMany.mockResolvedValue([
        { studentId: 's1', snapshotId: SNAP_V2_ID, rank: 1, totalScore: 92, isEligible: true, program: 'HOPE' },
      ]);

      const results = await selResultService.getSelectionResults(CYCLE_ID);

      expect(results[0].snapshotVersion).toBe(2);
      expect(results[0].snapshotId).toBe(SNAP_V2_ID);
      expect(results[0].source).toBe('SNAPSHOT');
    });

    it('returns v3 results after re-freeze to v3', async () => {
      srPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockClassSvc.resolveSelectionAuthority.mockResolvedValue({
        source: 'SNAPSHOT',
        snapshotId: SNAP_V3_ID,
        snapshotVersion: 3,
      });
      srPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V3_ID,
        version: 3,
        frozenAt: FROZEN_AT_V3,
        totalStudents: 1,
      });
      srPrisma.rankingSnapshotEntry.findMany.mockResolvedValue([
        { studentId: 's1', snapshotId: SNAP_V3_ID, rank: 1, totalScore: 95, isEligible: true, program: 'HOPE' },
      ]);

      const results = await selResultService.getSelectionResults(CYCLE_ID);

      expect(results[0].snapshotVersion).toBe(3);
      expect(results[0].snapshotId).toBe(SNAP_V3_ID);
    });

    it('result reads rank and score exclusively from the new snapshot entries', async () => {
      srPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockClassSvc.resolveSelectionAuthority.mockResolvedValue({
        source: 'SNAPSHOT',
        snapshotId: SNAP_V2_ID,
        snapshotVersion: 2,
      });
      srPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V2_ID,
        version: 2,
        frozenAt: FROZEN_AT_V2,
        totalStudents: 1,
      });
      srPrisma.rankingSnapshotEntry.findMany.mockResolvedValue([
        { studentId: 's1', snapshotId: SNAP_V2_ID, rank: 2, totalScore: 88, isEligible: true, program: 'PEP' },
      ]);

      const results = await selResultService.getSelectionResults(CYCLE_ID);

      // rank=2 and score=88 come from v2 entries, not live tables
      expect(results[0].rank).toBe(2);
      expect(results[0].score).toBe(88);
      expect(results[0].programCode).toBe('PEP');
      // Live tables not consulted
      expect(srPrisma.studentRanking.findMany).not.toHaveBeenCalled();
      expect(srPrisma.hopePepClassification.findMany).not.toHaveBeenCalled();
    });

    it('decisionReference encodes the new snapshot version', async () => {
      srPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockClassSvc.resolveSelectionAuthority.mockResolvedValue({
        source: 'SNAPSHOT',
        snapshotId: SNAP_V2_ID,
        snapshotVersion: 2,
      });
      srPrisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAP_V2_ID,
        version: 2,
        frozenAt: FROZEN_AT_V2,
        totalStudents: 1,
      });
      srPrisma.rankingSnapshotEntry.findMany.mockResolvedValue([
        { studentId: 's1', snapshotId: SNAP_V2_ID, rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await selResultService.getSelectionResults(CYCLE_ID);

      expect(results[0].decisionReference).toContain(`SNAP:${SNAP_V2_ID}:v2`);
    });
  });

  // ─────────────────────────────────────
  // Audit events
  // ─────────────────────────────────────

  describe('audit events', () => {
    it('logs REFREEZE_STARTED before any state change', async () => {
      setupSuccessfulRefreeze(prisma);

      await service.refreeze(CYCLE_ID, 'admin-x');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFREEZE_STARTED', actor: 'admin-x' }),
      );
    });

    it('REFREEZE_STARTED includes previousSnapshotId and previousVersion', async () => {
      setupSuccessfulRefreeze(prisma, { currentVersion: 1 });

      await service.refreeze(CYCLE_ID, 'admin');

      const startedCall = mockAudit.log.mock.calls.find(
        (c: [{ action: string }]) => c[0].action === 'REFREEZE_STARTED',
      );
      expect(startedCall[0].metadata.previousSnapshotId).toBe(SNAP_V1_ID);
      expect(startedCall[0].metadata.previousVersion).toBe(1);
    });

    it('logs REFREEZE_COMPLETED on success', async () => {
      setupSuccessfulRefreeze(prisma, { nextSnapId: SNAP_V2_ID, nextVersion: 2 });

      await service.refreeze(CYCLE_ID, 'admin');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFREEZE_COMPLETED' }),
      );
    });

    it('REFREEZE_COMPLETED includes newSnapshotId, newVersion, previousSnapshotId, previousVersion', async () => {
      setupSuccessfulRefreeze(prisma, {
        currentVersion: 1,
        nextSnapId: SNAP_V2_ID,
        nextVersion: 2,
      });

      await service.refreeze(CYCLE_ID, 'admin');

      const completedCall = mockAudit.log.mock.calls.find(
        (c: [{ action: string }]) => c[0].action === 'REFREEZE_COMPLETED',
      );
      expect(completedCall[0].metadata.newSnapshotId).toBe(SNAP_V2_ID);
      expect(completedCall[0].metadata.newVersion).toBe(2);
      expect(completedCall[0].metadata.previousSnapshotId).toBe(SNAP_V1_ID);
      expect(completedCall[0].metadata.previousVersion).toBe(1);
    });

    it('logs REFREEZE_FAILED on error and re-throws', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.cycleConfig.findUnique.mockRejectedValue(new Error('DB timeout'));

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow('DB timeout');

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFREEZE_FAILED' }),
      );
    });

    it('REFREEZE_FAILED includes previousSnapshotId for traceability', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.cycleConfig.findUnique.mockRejectedValue(new Error('DB timeout'));

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      const failedCall = mockAudit.log.mock.calls.find(
        (c: [{ action: string }]) => c[0].action === 'REFREEZE_FAILED',
      );
      expect(failedCall[0].metadata.previousSnapshotId).toBe(SNAP_V1_ID);
    });
  });

  // ─────────────────────────────────────
  // Failure safety / transaction rollback
  // ─────────────────────────────────────

  describe('failure safety', () => {
    it('transaction failure does not expose a partial new snapshot', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.$transaction.mockRejectedValue(new Error('DB constraint violation'));

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      // prisma.rankingSnapshot.create was NEVER called outside the transaction
      expect(prisma.rankingSnapshot.create).not.toHaveBeenCalled();
    });

    it('transaction failure preserves the old EXECUTED schedule', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.$transaction.mockRejectedValue(new Error('Unique constraint failed'));

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      // freezeSchedule.update was never called (no modification to old schedule)
      expect(prisma.freezeSchedule.update).not.toHaveBeenCalled();
    });

    it('duplicate version (concurrent re-freeze) causes transaction to throw', async () => {
      setupSuccessfulRefreeze(prisma);
      prisma.$transaction.mockRejectedValue(
        new Error(
          'Unique constraint failed on the fields: (`selectionCycleId`,`version`)',
        ),
      );

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        /Unique constraint/,
      );
    });
  });

  // ─────────────────────────────────────
  // Return value
  // ─────────────────────────────────────

  describe('return value', () => {
    it('returns snapshotId, version, previousSnapshotId, previousVersion, studentCount, hopeCount, pepCount', async () => {
      setupSuccessfulRefreeze(prisma, {
        currentVersion: 1,
        nextSnapId: SNAP_V2_ID,
        nextVersion: 2,
      });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result).toMatchObject({
        snapshotId: SNAP_V2_ID,
        version: 2,
        previousSnapshotId: SNAP_V1_ID,
        previousVersion: 1,
        studentCount: 3,
        hopeCount: expect.any(Number),
        pepCount: expect.any(Number),
      });
    });
  });

  // ─────────────────────────────────────
  // Empty ranking guard (14.1 hardening)
  // ─────────────────────────────────────

  describe('empty ranking guard', () => {
    function setupEmptyRankingWithStudents() {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-executed',
        status: 'EXECUTED',
        snapshotId: SNAP_V1_ID,
        executedAt: FROZEN_AT_V1,
        selectionCycleId: CYCLE_ID,
      });
      prisma.rankingSnapshot.findFirst
        .mockResolvedValueOnce({ id: SNAP_V1_ID, version: 1, frozenAt: FROZEN_AT_V1 })
        .mockResolvedValueOnce({ version: 1 });
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: 'wv-1',
        eligibilityRuleVersionId: null,
        hopeCount: 1,
        pepCount: 1,
      });
      prisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-1',
        version: 1,
        weights: [{ parameterKey: 'coding', weight: 0.5 }],
      });
      // Empty rankings — ranking engine has not been run
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentScore.findMany.mockResolvedValue([]);
      prisma.eligibilityResult.findMany.mockResolvedValue([]);
      // But the cycle has 5 enrolled students
      prisma.studentCycleStatus.count.mockResolvedValue(5);
    }

    it('rejects when cycle has students but StudentRanking is empty', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejection message mentions ranking calculation', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow(
        /ranking/i,
      );
    });

    it('no new RankingSnapshot is created on this failure', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('no new FreezeSchedule is created on this failure', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      expect(prisma.freezeSchedule.create).not.toHaveBeenCalled();
    });

    it('previous EXECUTED FreezeSchedule is not modified', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      expect(prisma.freezeSchedule.update).not.toHaveBeenCalled();
    });

    it('logs REFREEZE_FAILED when guard triggers', async () => {
      setupEmptyRankingWithStudents();

      await expect(service.refreeze(CYCLE_ID, 'admin')).rejects.toThrow();

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFREEZE_FAILED' }),
      );
    });

    it('allows re-freeze on a genuinely empty cycle (zero students)', async () => {
      setupSuccessfulRefreeze(prisma);
      // Override rankings to empty and student count to 0
      prisma.studentRanking.findMany.mockResolvedValue([]);
      prisma.studentCycleStatus.count.mockResolvedValue(0);

      // Should not throw — zero-student re-freeze of an empty cycle is allowed
      const result = await service.refreeze(CYCLE_ID, 'admin');

      expect(result.studentCount).toBe(0);
    });

    it('successful re-freeze with valid rankings still creates the expected student count', async () => {
      setupSuccessfulRefreeze(prisma, { nextSnapId: SNAP_V2_ID, nextVersion: 2 });

      const result = await service.refreeze(CYCLE_ID, 'admin');

      // 3 students in buildRankings()
      expect(result.studentCount).toBe(3);
    });
  });
});
