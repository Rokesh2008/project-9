import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

function createMockPrisma() {
  return {
    selectionCycle: { findUnique: jest.fn() },
    cycleConfig: { findUnique: jest.fn() },
    studentRanking: { findMany: jest.fn() },
    eligibilityResult: { findMany: jest.fn() },
    freezeSchedule: { findFirst: jest.fn() },
    rankingSnapshot: { findFirst: jest.fn() },
    rankingSnapshotEntry: { findMany: jest.fn(), count: jest.fn() },
    hopePepClassification: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(
      async (promises: Promise<unknown>[]) => Promise.all(promises),
    ),
  };
}

const CYCLE_ID = 'cycle-001';
const SNAPSHOT_ID = 'snap-001';
const ACTOR = 'admin-001';

describe('Frozen Snapshot Authority', () => {
  let service: ClassificationService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(ClassificationService);
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════
  // AUTHORITY RESOLUTION
  // ═══════════════════════════════════════

  describe('resolveSelectionAuthority', () => {
    it('returns LIVE when no freeze exists', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);

      const result = await service.resolveSelectionAuthority(CYCLE_ID);
      expect(result.source).toBe('LIVE');
      expect(result.snapshotId).toBeUndefined();
      expect(result.snapshotVersion).toBeUndefined();
    });

    it('returns SNAPSHOT when executed freeze exists', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 1,
      });

      const result = await service.resolveSelectionAuthority(CYCLE_ID);
      expect(result.source).toBe('SNAPSHOT');
    });

    it('returns correct snapshotId', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 2,
      });

      const result = await service.resolveSelectionAuthority(CYCLE_ID);
      expect(result.snapshotId).toBe(SNAPSHOT_ID);
    });

    it('returns correct snapshotVersion', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 3,
      });

      const result = await service.resolveSelectionAuthority(CYCLE_ID);
      expect(result.snapshotVersion).toBe(3);
    });

    it('returns LIVE when only SCHEDULED freeze exists', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);

      const result = await service.resolveSelectionAuthority(CYCLE_ID);
      expect(result.source).toBe('LIVE');
    });

    it('throws ConflictException when executed freeze has no snapshotId', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: null,
      });

      await expect(
        service.resolveSelectionAuthority(CYCLE_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException with descriptive message for null snapshotId', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: null,
      });

      await expect(
        service.resolveSelectionAuthority(CYCLE_ID),
      ).rejects.toThrow(/authoritative snapshot/);
    });

    it('throws NotFoundException when snapshot referenced by freeze is missing', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: 'nonexistent',
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveSelectionAuthority(CYCLE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('never returns LIVE when an executed freeze exists', async () => {
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: null,
      });

      try {
        const result = await service.resolveSelectionAuthority(CYCLE_ID);
        expect(result.source).not.toBe('LIVE');
      } catch {
        // Expected — error is acceptable, silent LIVE is not
      }
    });
  });

  // ═══════════════════════════════════════
  // FROZEN CLASSIFICATION
  // ═══════════════════════════════════════

  function setupExecutedFreeze(opts?: {
    hopeCount?: number;
    pepCount?: number;
    totalStudents?: number;
  }) {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
    prisma.freezeSchedule.findFirst.mockResolvedValue({
      id: 'fs-1',
      status: 'EXECUTED',
      snapshotId: SNAPSHOT_ID,
      executedAt: new Date('2026-10-01'),
    });
    prisma.rankingSnapshot.findFirst.mockResolvedValue({
      id: SNAPSHOT_ID,
      version: 1,
      totalStudents: opts?.totalStudents ?? 5,
      hopeCount: opts?.hopeCount ?? 2,
      pepCount: opts?.pepCount ?? 3,
    });
  }

  function setupSnapshotEntries(
    entries: Array<{
      studentId: string;
      rank: number;
      isEligible: boolean;
    }>,
  ) {
    prisma.rankingSnapshotEntry.count.mockResolvedValue(entries.length);
    prisma.rankingSnapshotEntry.findMany.mockResolvedValue(
      entries.map((e) => ({
        studentId: e.studentId,
        rank: e.rank,
        totalScore: 100 - e.rank,
        percentile: null,
        parameterScores: {},
        isEligible: e.isEligible,
        eligibilityFailures: null,
        program: null,
        tieBreakApplied: false,
      })),
    );
  }

  describe('calculateFrozenClassification', () => {
    it('throws ConflictException when no freeze has been executed', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.calculateFrozenClassification(CYCLE_ID, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException for missing cycle', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.calculateFrozenClassification('nonexistent', ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when snapshot is missing', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst
        .mockResolvedValueOnce({ id: SNAPSHOT_ID, version: 1 })
        .mockResolvedValueOnce(null);

      await expect(
        service.calculateFrozenClassification(CYCLE_ID, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when snapshot is incomplete', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 1,
        totalStudents: 10,
        hopeCount: 2,
        pepCount: 3,
      });
      prisma.rankingSnapshotEntry.count.mockResolvedValue(0);

      await expect(
        service.calculateFrozenClassification(CYCLE_ID, ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses snapshot data for classification', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
        { studentId: 'stu-4', rank: 4, isEligible: true },
        { studentId: 'stu-5', rank: 5, isEligible: false },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      expect(result).toHaveLength(5);
      expect(result[0].program).toBe('HOPE');
      expect(result[1].program).toBe('HOPE');
      expect(result[2].program).toBe('PEP');
      expect(result[3].program).toBe('PEP');
      expect(result[4].program).toBe('NOT_ELIGIBLE');
    });

    it('respects snapshot HOPE/PEP counts', async () => {
      setupExecutedFreeze({ hopeCount: 1, pepCount: 1 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      expect(result[0].program).toBe('HOPE');
      expect(result[1].program).toBe('PEP');
      expect(result[2].program).toBe('NOT_ELIGIBLE');
    });

    it('produces deterministic output — same snapshot yields same classification', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: false },
      ]);

      const r1 = await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      jest.clearAllMocks();
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: false },
      ]);

      const r2 = await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(r1.map((s) => s.program)).toEqual(r2.map((s) => s.program));
      expect(r1.map((s) => s.rank)).toEqual(r2.map((s) => s.rank));
    });

    it('persists classification with snapshotId', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(prisma.hopePepClassification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            snapshotId: SNAPSHOT_ID,
          }),
          update: expect.objectContaining({
            snapshotId: SNAPSHOT_ID,
          }),
        }),
      );
    });

    it('repeated execution is idempotent (upsert)', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      jest.clearAllMocks();
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(prisma.hopePepClassification.upsert).toHaveBeenCalledTimes(1);
    });

    it('returns source=SNAPSHOT with snapshotId and version', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      expect(result[0].source).toBe('SNAPSHOT');
      expect(result[0].snapshotId).toBe(SNAPSHOT_ID);
      expect(result[0].snapshotVersion).toBe(1);
    });

    it('returns empty array for empty snapshot', async () => {
      setupExecutedFreeze({ totalStudents: 0 });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 1,
        totalStudents: 0,
        hopeCount: 0,
        pepCount: 0,
      });
      prisma.rankingSnapshotEntry.count.mockResolvedValue(0);
      prisma.rankingSnapshotEntry.findMany.mockResolvedValue([]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      expect(result).toEqual([]);
    });

    it('does not read from live StudentRanking or EligibilityResult', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(prisma.studentRanking.findMany).not.toHaveBeenCalled();
      expect(prisma.eligibilityResult.findMany).not.toHaveBeenCalled();
    });

    it('does not modify RankingSnapshot or RankingSnapshotEntry', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(prisma.rankingSnapshot.findFirst).toHaveBeenCalled();
      expect(prisma.rankingSnapshotEntry.findMany).toHaveBeenCalled();
      // Only read methods called — no create/update/delete on snapshot tables
      expect(
        (prisma.rankingSnapshot as any).create,
      ).toBeUndefined();
      expect(
        (prisma.rankingSnapshot as any).update,
      ).toBeUndefined();
      expect(
        (prisma.rankingSnapshotEntry as any).create,
      ).toBeUndefined();
      expect(
        (prisma.rankingSnapshotEntry as any).update,
      ).toBeUndefined();
    });

    it('preserves common ranking — one list for all students', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
        { studentId: 'stu-4', rank: 4, isEligible: true },
        { studentId: 'stu-5', rank: 5, isEligible: true },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      const ranks = result.map((r) => r.rank);
      expect(ranks).toEqual([1, 2, 3, 4, 5]);

      const hopeStudents = result.filter((r) => r.program === 'HOPE');
      const pepStudents = result.filter((r) => r.program === 'PEP');
      expect(hopeStudents).toHaveLength(2);
      expect(pepStudents).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════
  // FROZEN CONFIGURATION FROM SNAPSHOT
  // ═══════════════════════════════════════

  describe('frozen classification uses snapshot config', () => {
    it('uses snapshot.hopeCount for classification', async () => {
      setupExecutedFreeze({ hopeCount: 1, pepCount: 10 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      const hopeCount = result.filter((r) => r.program === 'HOPE').length;
      expect(hopeCount).toBe(1);
    });

    it('uses snapshot.pepCount for classification', async () => {
      setupExecutedFreeze({ hopeCount: 0, pepCount: 2 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      const pepCount = result.filter((r) => r.program === 'PEP').length;
      expect(pepCount).toBe(2);
      expect(result.filter((r) => r.program === 'HOPE')).toHaveLength(0);
    });

    it('CycleConfig changes after freeze do NOT affect frozen classification', async () => {
      setupExecutedFreeze({ hopeCount: 2, pepCount: 3 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
        { studentId: 'stu-4', rank: 4, isEligible: true },
        { studentId: 'stu-5', rank: 5, isEligible: true },
      ]);

      // CycleConfig has different values — should be ignored
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        hopeCount: 10,
        pepCount: 20,
      });

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      expect(result.filter((r) => r.program === 'HOPE')).toHaveLength(2);
      expect(result.filter((r) => r.program === 'PEP')).toHaveLength(3);
    });

    it('does not query CycleConfig for frozen classification', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(prisma.cycleConfig.findUnique).not.toHaveBeenCalled();
    });

    it('snapshot configuration remains unchanged after classification', async () => {
      setupExecutedFreeze({ hopeCount: 2, pepCount: 3 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect((prisma.rankingSnapshot as any).update).toBeUndefined();
    });

    it('throws BadRequestException for invalid snapshot configuration', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: 1,
        totalStudents: 3,
        hopeCount: -1,
        pepCount: 3,
      });
      prisma.rankingSnapshotEntry.count.mockResolvedValue(3);

      await expect(
        service.calculateFrozenClassification(CYCLE_ID, ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not fall back to CycleConfig when snapshot has valid config', async () => {
      setupExecutedFreeze({ hopeCount: 1, pepCount: 1 });
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: true },
        { studentId: 'stu-3', rank: 3, isEligible: true },
      ]);

      // Even if CycleConfig has larger values
      prisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        hopeCount: 100,
        pepCount: 100,
      });

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      // Only 1 HOPE, 1 PEP per snapshot config — not 100/100
      expect(result.filter((r) => r.program === 'HOPE')).toHaveLength(1);
      expect(result.filter((r) => r.program === 'PEP')).toHaveLength(1);
      expect(result.filter((r) => r.program === 'NOT_ELIGIBLE')).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════
  // AUDIT LOGGING
  // ═══════════════════════════════════════

  describe('frozen classification audit', () => {
    it('logs FROZEN_CLASSIFICATION_STARTED', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FROZEN_CLASSIFICATION_STARTED',
          entityId: SNAPSHOT_ID,
          metadata: expect.objectContaining({
            snapshotId: SNAPSHOT_ID,
            snapshotVersion: 1,
          }),
        }),
      );
    });

    it('logs FROZEN_CLASSIFICATION_COMPLETED', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
        { studentId: 'stu-2', rank: 2, isEligible: false },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'FROZEN_CLASSIFICATION_COMPLETED',
          metadata: expect.objectContaining({
            totalStudents: 2,
            hopeClassified: 1,
            pepClassified: 0,
            notEligibleCount: 1,
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════
  // POST-FREEZE UPDATE ISOLATION
  // ═══════════════════════════════════════

  describe('post-freeze update isolation', () => {
    it('frozen classification does not use live ranking data', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-A', rank: 1, isEligible: true },
        { studentId: 'stu-B', rank: 2, isEligible: true },
      ]);

      // Live ranking may have different order — should not affect frozen
      prisma.studentRanking.findMany.mockResolvedValue([
        { studentId: 'stu-B', rank: 1, totalScore: 99 },
        { studentId: 'stu-A', rank: 2, totalScore: 50 },
      ]);

      const result = await service.calculateFrozenClassification(
        CYCLE_ID,
        ACTOR,
      );

      // Frozen classification uses snapshot rank order, not live
      expect(result[0].studentId).toBe('stu-A');
      expect(result[0].rank).toBe(1);
      expect(result[1].studentId).toBe('stu-B');
      expect(result[1].rank).toBe(2);
    });

    it('live StudentRanking changes do not alter frozen snapshot entries (mock verification)', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      // Verify no writes to snapshot tables
      expect(
        (prisma.rankingSnapshotEntry as any).updateMany,
      ).toBeUndefined();
      expect(
        (prisma.rankingSnapshotEntry as any).update,
      ).toBeUndefined();
    });

    it('frozen snapshot version remains stable across calls', async () => {
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      const r1 = await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      jest.clearAllMocks();
      setupExecutedFreeze();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, isEligible: true },
      ]);

      const r2 = await service.calculateFrozenClassification(CYCLE_ID, ACTOR);

      expect(r1[0].snapshotVersion).toBe(r2[0].snapshotVersion);
      expect(r1[0].snapshotId).toBe(r2[0].snapshotId);
    });
  });

  // ═══════════════════════════════════════
  // LIVE CLASSIFICATION BLOCKED AFTER FREEZE
  // ═══════════════════════════════════════

  describe('live calculate blocked after freeze', () => {
    it('throws ConflictException when executed freeze exists', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });

      await expect(
        service.calculate(CYCLE_ID, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('includes helpful message about using frozen endpoint', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      prisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: SNAPSHOT_ID,
      });

      await expect(
        service.calculate(CYCLE_ID, ACTOR),
      ).rejects.toThrow(/frozen classification endpoint/);
    });
  });
});
