import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SelectionResultService } from '../src/member1/selection/selection-result.service';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { PrismaService } from '../src/common/prisma.service';

function createMockPrisma() {
  return {
    selectionCycle: { findUnique: jest.fn() },
    hopePepClassification: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    studentRanking: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    rankingSnapshotEntry: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    rankingSnapshot: {
      findFirst: jest.fn(),
    },
  };
}

const CYCLE_ID = 'cycle-001';
const SNAPSHOT_ID = 'snap-001';
const SNAPSHOT_VERSION = 1;
const FROZEN_AT = new Date('2026-10-01T08:00:00Z');

describe('SelectionResultService', () => {
  let service: SelectionResultService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let mockClassification: { resolveSelectionAuthority: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    mockClassification = {
      resolveSelectionAuthority: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelectionResultService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClassificationService, useValue: mockClassification },
      ],
    }).compile();

    service = module.get(SelectionResultService);
  });

  function setupCycle() {
    prisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
  }

  function setupLiveAuthority() {
    mockClassification.resolveSelectionAuthority.mockResolvedValue({
      source: 'LIVE',
    });
  }

  function setupSnapshotAuthority() {
    mockClassification.resolveSelectionAuthority.mockResolvedValue({
      source: 'SNAPSHOT',
      snapshotId: SNAPSHOT_ID,
      snapshotVersion: SNAPSHOT_VERSION,
    });
  }

  function setupLiveClassifications(
    records: Array<{
      studentId: string;
      program: string;
      rank: number;
    }>,
  ) {
    prisma.hopePepClassification.findMany.mockResolvedValue(
      records.map((r) => ({
        studentId: r.studentId,
        selectionCycleId: CYCLE_ID,
        program: r.program,
        rank: r.rank,
        status: 'CLASSIFIED',
        snapshotId: null,
        classifiedAt: new Date('2026-10-01'),
      })),
    );
  }

  function setupLiveRankings(
    records: Array<{
      studentId: string;
      totalScore: number;
    }>,
  ) {
    prisma.studentRanking.findMany.mockResolvedValue(
      records.map((r) => ({
        studentId: r.studentId,
        selectionCycleId: CYCLE_ID,
        totalScore: r.totalScore,
      })),
    );
  }

  function setupSnapshotEntries(
    entries: Array<{
      studentId: string;
      rank: number;
      totalScore: number;
      isEligible: boolean;
      program?: string | null;
    }>,
  ) {
    prisma.rankingSnapshotEntry.findMany.mockResolvedValue(
      entries.map((e) => ({
        studentId: e.studentId,
        snapshotId: SNAPSHOT_ID,
        rank: e.rank,
        totalScore: e.totalScore,
        isEligible: e.isEligible,
        program: e.program ?? null,
        percentile: null,
        parameterScores: {},
        tieBreakApplied: false,
      })),
    );
  }

  // Snapshot metadata — no HopePepClassification, no StudentRanking
  function setupSnapshot(opts?: { frozenAt?: Date; totalStudents?: number }) {
    prisma.rankingSnapshot.findFirst.mockResolvedValue({
      id: SNAPSHOT_ID,
      version: SNAPSHOT_VERSION,
      totalStudents: opts?.totalStudents ?? 5,
      frozenAt: opts?.frozenAt ?? FROZEN_AT,
      hopeCount: 2,
      pepCount: 3,
    });
  }

  // ──────────────────────────────────────────
  // Authority resolution
  // ──────────────────────────────────────────

  describe('authority resolution', () => {
    it('returns LIVE source when no freeze exists', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 90 }]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].source).toBe('LIVE');
      expect(results[0].snapshotId).toBeUndefined();
      expect(results[0].snapshotVersion).toBeUndefined();
    });

    it('returns SNAPSHOT source when executed freeze exists', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].source).toBe('SNAPSHOT');
      expect(results[0].snapshotId).toBe(SNAPSHOT_ID);
      expect(results[0].snapshotVersion).toBe(SNAPSHOT_VERSION);
    });

    it('propagates ConflictException for missing snapshotId', async () => {
      setupCycle();
      mockClassification.resolveSelectionAuthority.mockRejectedValue(
        new ConflictException('Executed freeze has no snapshot.'),
      );

      await expect(
        service.getSelectionResults(CYCLE_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates NotFoundException for missing snapshot', async () => {
      setupCycle();
      mockClassification.resolveSelectionAuthority.mockRejectedValue(
        new NotFoundException('Snapshot referenced by executed freeze not found'),
      );

      await expect(
        service.getSelectionResults(CYCLE_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────────────────────────────────────
  // Live selection results
  // ──────────────────────────────────────────

  describe('live selection results', () => {
    it('returns correct student IDs', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
        { studentId: 'stu-2', program: 'PEP', rank: 2 },
      ]);
      setupLiveRankings([
        { studentId: 'stu-1', totalScore: 95 },
        { studentId: 'stu-2', totalScore: 80 },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results.map((r) => r.studentId)).toEqual(['stu-1', 'stu-2']);
    });

    it('returns correct rank', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
        { studentId: 'stu-2', program: 'PEP', rank: 2 },
      ]);
      setupLiveRankings([
        { studentId: 'stu-1', totalScore: 95 },
        { studentId: 'stu-2', totalScore: 80 },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].rank).toBe(1);
      expect(results[1].rank).toBe(2);
    });

    it('returns correct score from StudentRanking', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 87.5 }]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].score).toBe(87.5);
    });

    it('returns correct program classification', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
        { studentId: 'stu-2', program: 'PEP', rank: 2 },
        { studentId: 'stu-3', program: 'NOT_ELIGIBLE', rank: 3 },
      ]);
      setupLiveRankings([
        { studentId: 'stu-1', totalScore: 95 },
        { studentId: 'stu-2', totalScore: 80 },
        { studentId: 'stu-3', totalScore: 60 },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].programCode).toBe('HOPE');
      expect(results[0].selected).toBe(true);
      expect(results[1].programCode).toBe('PEP');
      expect(results[1].selected).toBe(true);
      expect(results[2].programCode).toBe('NOT_ELIGIBLE');
      expect(results[2].selected).toBe(false);
    });

    it('produces deterministic decisionReference', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 90 }]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].decisionReference).toBe(
        `SEL:${CYCLE_ID}:stu-1:LIVE`,
      );
    });

    it('repeated reads return equivalent results', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 90 }]);

      const results1 = await service.getSelectionResults(CYCLE_ID);

      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 90 }]);

      const results2 = await service.getSelectionResults(CYCLE_ID);

      expect(results1[0].studentId).toBe(results2[0].studentId);
      expect(results1[0].programCode).toBe(results2[0].programCode);
      expect(results1[0].rank).toBe(results2[0].rank);
      expect(results1[0].score).toBe(results2[0].score);
      expect(results1[0].decisionReference).toBe(
        results2[0].decisionReference,
      );
    });
  });

  // ──────────────────────────────────────────
  // Frozen selection results
  // ──────────────────────────────────────────

  describe('frozen selection results', () => {
    it('uses snapshot rank', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 3, totalScore: 85, isEligible: true, program: 'PEP' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].rank).toBe(3);
    });

    it('uses snapshot score', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 92.3, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].score).toBe(92.3);
    });

    it('uses snapshot eligibility/classification data', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
        { studentId: 'stu-2', rank: 2, totalScore: 80, isEligible: false, program: 'NOT_ELIGIBLE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].selected).toBe(true);
      expect(results[0].programCode).toBe('HOPE');
      expect(results[1].selected).toBe(false);
      expect(results[1].programCode).toBe('NOT_ELIGIBLE');
    });

    it('includes snapshotId', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].snapshotId).toBe(SNAPSHOT_ID);
    });

    it('includes snapshotVersion', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].snapshotVersion).toBe(SNAPSHOT_VERSION);
    });

    it('does not read live StudentRanking as a fallback', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      expect(prisma.studentRanking.findMany).not.toHaveBeenCalled();
    });

    it('does not read live scores as a fallback', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      expect(prisma.studentRanking.findMany).not.toHaveBeenCalled();
      expect(prisma.studentRanking.findUnique).not.toHaveBeenCalled();
    });

    it('does not read live eligibility as a fallback', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      expect(prisma.studentRanking.findMany).not.toHaveBeenCalled();
    });

    it('snapshot remains unchanged (read-only)', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      const snapshotEntryKeys = Object.keys(prisma.rankingSnapshotEntry);
      for (const key of snapshotEntryKeys) {
        if (key !== 'findMany' && key !== 'findFirst') {
          const fn = (prisma.rankingSnapshotEntry as Record<string, jest.Mock>)[key];
          if (fn && typeof fn.mock !== 'undefined') {
            expect(fn).not.toHaveBeenCalled();
          }
        }
      }
    });

    it('repeated frozen reads are deterministic', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const r1 = await service.getSelectionResults(CYCLE_ID);

      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const r2 = await service.getSelectionResults(CYCLE_ID);

      expect(r1[0].decisionReference).toBe(r2[0].decisionReference);
      expect(r1[0].rank).toBe(r2[0].rank);
      expect(r1[0].score).toBe(r2[0].score);
      expect(r1[0].programCode).toBe(r2[0].programCode);
    });

    it('frozen decisionReference includes snapshot info', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].decisionReference).toBe(
        `SEL:${CYCLE_ID}:stu-1:SNAP:${SNAPSHOT_ID}:v${SNAPSHOT_VERSION}`,
      );
    });
  });

  // ──────────────────────────────────────────
  // Frozen result source strictness (hardening)
  // ──────────────────────────────────────────

  describe('frozen result source strictness', () => {
    it('programCode comes from RankingSnapshotEntry.program, not HopePepClassification', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      // Entry says PEP — no HopePepClassification set up at all
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'PEP' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].programCode).toBe('PEP');
      // HopePepClassification must not have been queried
      expect(prisma.hopePepClassification.findMany).not.toHaveBeenCalled();
      expect(prisma.hopePepClassification.findUnique).not.toHaveBeenCalled();
    });

    it('frozen result does not query HopePepClassification.findMany', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      expect(prisma.hopePepClassification.findMany).not.toHaveBeenCalled();
    });

    it('frozen result does not query StudentRanking', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      await service.getSelectionResults(CYCLE_ID);

      expect(prisma.studentRanking.findMany).not.toHaveBeenCalled();
      expect(prisma.studentRanking.findUnique).not.toHaveBeenCalled();
    });

    it('frozen single-student result does not query HopePepClassification', async () => {
      setupCycle();
      setupSnapshotAuthority();
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: SNAPSHOT_VERSION,
        frozenAt: FROZEN_AT,
        totalStudents: 3,
      });
      prisma.rankingSnapshotEntry.findFirst.mockResolvedValue({
        studentId: 'stu-1',
        snapshotId: SNAPSHOT_ID,
        rank: 1,
        totalScore: 90,
        isEligible: true,
        program: 'HOPE',
      });

      const result = await service.getStudentSelectionResult(CYCLE_ID, 'stu-1');

      expect(result).not.toBeNull();
      expect(result!.programCode).toBe('HOPE');
      expect(prisma.hopePepClassification.findUnique).not.toHaveBeenCalled();
      expect(prisma.hopePepClassification.findMany).not.toHaveBeenCalled();
    });

    it('selected=true for HOPE entry from snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      // selected means "classified into HOPE or PEP", not final human selection
      expect(results[0].selected).toBe(true);
      expect(results[0].programCode).toBe('HOPE');
    });

    it('selected=true for PEP entry from snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'PEP' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].selected).toBe(true);
      expect(results[0].programCode).toBe('PEP');
    });

    it('selected=false for NOT_ELIGIBLE entry from snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 5, totalScore: 40, isEligible: false, program: 'NOT_ELIGIBLE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results[0].selected).toBe(false);
      expect(results[0].programCode).toBe('NOT_ELIGIBLE');
    });

    it('broken frozen state still fails closed (ConflictException)', async () => {
      setupCycle();
      mockClassification.resolveSelectionAuthority.mockRejectedValue(
        new ConflictException('Executed freeze has no snapshot.'),
      );

      await expect(service.getSelectionResults(CYCLE_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('broken frozen state still fails closed (NotFoundException)', async () => {
      setupCycle();
      mockClassification.resolveSelectionAuthority.mockRejectedValue(
        new NotFoundException('Snapshot referenced by executed freeze not found'),
      );

      await expect(service.getSelectionResults(CYCLE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('incomplete snapshot still throws BadRequestException', async () => {
      setupCycle();
      setupSnapshotAuthority();
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        totalStudents: 5,
        frozenAt: FROZEN_AT,
      });
      prisma.rankingSnapshotEntry.findMany.mockResolvedValue([]);

      await expect(service.getSelectionResults(CYCLE_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────────────────────
  // Contract compatibility
  // ──────────────────────────────────────────

  describe('contract compatibility', () => {
    it('returns all SelectionResultContract fields for live', async () => {
      setupCycle();
      setupLiveAuthority();
      setupLiveClassifications([
        { studentId: 'stu-1', program: 'HOPE', rank: 1 },
      ]);
      setupLiveRankings([{ studentId: 'stu-1', totalScore: 90 }]);

      const results = await service.getSelectionResults(CYCLE_ID);
      const result = results[0];

      expect(result).toHaveProperty('studentId');
      expect(result).toHaveProperty('selectionCycleId');
      expect(result).toHaveProperty('selected');
      expect(result).toHaveProperty('programCode');
      expect(result).toHaveProperty('rank');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('decisionReference');
      expect(result).toHaveProperty('evaluatedAt');
      expect(result).toHaveProperty('source');
    });

    it('returns all SelectionResultContract fields for snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      setupSnapshot();
      setupSnapshotEntries([
        { studentId: 'stu-1', rank: 1, totalScore: 90, isEligible: true, program: 'HOPE' },
      ]);

      const results = await service.getSelectionResults(CYCLE_ID);
      const result = results[0];

      expect(result).toHaveProperty('studentId');
      expect(result).toHaveProperty('selectionCycleId');
      expect(result).toHaveProperty('selected');
      expect(result).toHaveProperty('programCode');
      expect(result).toHaveProperty('rank');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('decisionReference');
      expect(result).toHaveProperty('evaluatedAt');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('snapshotId');
      expect(result).toHaveProperty('snapshotVersion');
    });
  });

  // ──────────────────────────────────────────
  // Error cases
  // ──────────────────────────────────────────

  describe('error cases', () => {
    it('throws NotFoundException for missing cycle', async () => {
      prisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.getSelectionResults('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no live classification data exists', async () => {
      setupCycle();
      setupLiveAuthority();
      prisma.hopePepClassification.findMany.mockResolvedValue([]);
      prisma.studentRanking.findMany.mockResolvedValue([]);

      await expect(
        service.getSelectionResults(CYCLE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for incomplete snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      prisma.rankingSnapshotEntry.findMany.mockResolvedValue([]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        totalStudents: 5,
        frozenAt: FROZEN_AT,
      });

      await expect(
        service.getSelectionResults(CYCLE_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns empty array for zero-student snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      prisma.rankingSnapshotEntry.findMany.mockResolvedValue([]);
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        totalStudents: 0,
        frozenAt: FROZEN_AT,
      });

      const results = await service.getSelectionResults(CYCLE_ID);

      expect(results).toEqual([]);
    });

    it('propagates authority resolution errors', async () => {
      setupCycle();
      mockClassification.resolveSelectionAuthority.mockRejectedValue(
        new ConflictException('Executed freeze has no snapshot.'),
      );

      await expect(
        service.getSelectionResults(CYCLE_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ──────────────────────────────────────────
  // Single student result
  // ──────────────────────────────────────────

  describe('getStudentSelectionResult', () => {
    it('returns null for student not found in live', async () => {
      setupCycle();
      setupLiveAuthority();
      prisma.hopePepClassification.findUnique.mockResolvedValue(null);

      const result = await service.getStudentSelectionResult(
        CYCLE_ID,
        'nonexistent',
      );
      expect(result).toBeNull();
    });

    it('returns null for student not found in snapshot', async () => {
      setupCycle();
      setupSnapshotAuthority();
      prisma.rankingSnapshot.findFirst.mockResolvedValue(null);
      prisma.rankingSnapshotEntry.findFirst.mockResolvedValue(null);

      const result = await service.getStudentSelectionResult(
        CYCLE_ID,
        'nonexistent',
      );
      expect(result).toBeNull();
    });

    it('returns live result for specific student', async () => {
      setupCycle();
      setupLiveAuthority();
      prisma.hopePepClassification.findUnique.mockResolvedValue({
        studentId: 'stu-1',
        selectionCycleId: CYCLE_ID,
        program: 'HOPE',
        rank: 1,
        status: 'CLASSIFIED',
        snapshotId: null,
        classifiedAt: new Date('2026-10-01'),
      });
      prisma.studentRanking.findUnique.mockResolvedValue({
        studentId: 'stu-1',
        selectionCycleId: CYCLE_ID,
        totalScore: 95,
      });

      const result = await service.getStudentSelectionResult(
        CYCLE_ID,
        'stu-1',
      );

      expect(result).not.toBeNull();
      expect(result!.studentId).toBe('stu-1');
      expect(result!.programCode).toBe('HOPE');
      expect(result!.source).toBe('LIVE');
      expect(result!.score).toBe(95);
    });

    it('returns frozen result for specific student using only snapshot data', async () => {
      setupCycle();
      setupSnapshotAuthority();
      // Frozen path: only snapshot + entry — no HopePepClassification
      prisma.rankingSnapshot.findFirst.mockResolvedValue({
        id: SNAPSHOT_ID,
        version: SNAPSHOT_VERSION,
        frozenAt: FROZEN_AT,
        totalStudents: 3,
      });
      prisma.rankingSnapshotEntry.findFirst.mockResolvedValue({
        studentId: 'stu-1',
        snapshotId: SNAPSHOT_ID,
        rank: 2,
        totalScore: 88,
        isEligible: true,
        program: 'PEP',
      });

      const result = await service.getStudentSelectionResult(
        CYCLE_ID,
        'stu-1',
      );

      expect(result).not.toBeNull();
      expect(result!.studentId).toBe('stu-1');
      expect(result!.programCode).toBe('PEP');
      expect(result!.source).toBe('SNAPSHOT');
      expect(result!.snapshotId).toBe(SNAPSHOT_ID);
      expect(result!.score).toBe(88);
      expect(result!.rank).toBe(2);
      // Must not have queried HopePepClassification
      expect(prisma.hopePepClassification.findUnique).not.toHaveBeenCalled();
      expect(prisma.hopePepClassification.findMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────
  // Decision reference
  // ──────────────────────────────────────────

  describe('decisionReference', () => {
    it('is deterministic for same inputs', () => {
      const authority = { source: 'LIVE' as const };
      const ref1 = service.buildDecisionReference(CYCLE_ID, 'stu-1', authority);
      const ref2 = service.buildDecisionReference(CYCLE_ID, 'stu-1', authority);
      expect(ref1).toBe(ref2);
    });

    it('differs between students', () => {
      const authority = { source: 'LIVE' as const };
      const ref1 = service.buildDecisionReference(CYCLE_ID, 'stu-1', authority);
      const ref2 = service.buildDecisionReference(CYCLE_ID, 'stu-2', authority);
      expect(ref1).not.toBe(ref2);
    });

    it('differs between LIVE and SNAPSHOT', () => {
      const live = { source: 'LIVE' as const };
      const snap = {
        source: 'SNAPSHOT' as const,
        snapshotId: SNAPSHOT_ID,
        snapshotVersion: SNAPSHOT_VERSION,
      };
      const refLive = service.buildDecisionReference(CYCLE_ID, 'stu-1', live);
      const refSnap = service.buildDecisionReference(CYCLE_ID, 'stu-1', snap);
      expect(refLive).not.toBe(refSnap);
    });

    it('includes snapshotId and version for SNAPSHOT', () => {
      const snap = {
        source: 'SNAPSHOT' as const,
        snapshotId: SNAPSHOT_ID,
        snapshotVersion: SNAPSHOT_VERSION,
      };
      const ref = service.buildDecisionReference(CYCLE_ID, 'stu-1', snap);
      expect(ref).toContain(SNAPSHOT_ID);
      expect(ref).toContain(`v${SNAPSHOT_VERSION}`);
    });
  });
});
