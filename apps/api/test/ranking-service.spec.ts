import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RankingService } from '../src/member1/ranking/ranking.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockPrisma = {
  selectionCycle: { findUnique: jest.fn() },
  cycleConfig: { findUnique: jest.fn() },
  weightVersion: { findUnique: jest.fn() },
  studentCycleStatus: { findMany: jest.fn() },
  studentScore: { findMany: jest.fn() },
  studentRanking: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

describe('RankingService', () => {
  let service: RankingService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(async (promises: Promise<unknown>[]) => {
      return Promise.all(promises);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(RankingService);
  });

  const CYCLE_ID = 'cycle-001';
  const WEIGHT_VERSION_ID = 'wv-001';
  const ACTOR = 'admin-001';

  function setupValidContext() {
    mockPrisma.selectionCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      code: 'C-2026',
    });
    mockPrisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WEIGHT_VERSION_ID,
    });
    mockPrisma.weightVersion.findUnique.mockResolvedValue({
      id: WEIGHT_VERSION_ID,
      version: 1,
      selectionCycleId: CYCLE_ID,
    });
  }

  function setupCycleStudents(studentIds: string[]) {
    mockPrisma.studentCycleStatus.findMany.mockResolvedValue(
      studentIds.map((id) => ({ studentId: id })),
    );
  }

  function setupScores(scores: Array<{ studentId: string; parameterKey: string; weightedScore: number }>) {
    mockPrisma.studentScore.findMany.mockResolvedValue(scores);
    const uniqueIds = [...new Set(scores.map((s) => s.studentId))];
    setupCycleStudents(uniqueIds);
  }

  // ──────────────────────────────────────────
  // resolveWeightVersion
  // ──────────────────────────────────────────

  describe('resolveWeightVersion', () => {
    it('throws NotFoundException for missing CycleConfig', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveWeightVersion(CYCLE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if no activeWeightVersionId', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: null,
      });

      await expect(
        service.resolveWeightVersion(CYCLE_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if weight version record missing', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: 'deleted-wv',
      });
      mockPrisma.weightVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveWeightVersion(CYCLE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves from explicit weightVersionId', async () => {
      mockPrisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-explicit',
        version: 2,
        selectionCycleId: CYCLE_ID,
      });

      const result = await service.resolveWeightVersion(CYCLE_ID, 'wv-explicit');
      expect(result.id).toBe('wv-explicit');
    });

    it('throws BadRequestException if explicit weight version belongs to different cycle', async () => {
      mockPrisma.weightVersion.findUnique.mockResolvedValue({
        id: 'wv-other',
        version: 1,
        selectionCycleId: 'other-cycle',
      });

      await expect(
        service.resolveWeightVersion(CYCLE_ID, 'wv-other'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────
  // calculate
  // ──────────────────────────────────────────

  describe('calculate', () => {
    it('throws NotFoundException for missing SelectionCycle', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.calculate('nonexistent', undefined, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when no score data exists', async () => {
      setupValidContext();
      setupScores([]);

      const result = await service.calculate(CYCLE_ID, undefined, ACTOR);
      expect(result).toEqual([]);
    });

    it('calculates and returns ranking for students with scores', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 40 },
        { studentId: 'stu-1', parameterKey: 'aptitude', weightedScore: 21 },
        { studentId: 'stu-2', parameterKey: 'coding', weightedScore: 25 },
        { studentId: 'stu-2', parameterKey: 'aptitude', weightedScore: 30 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      const result = await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(result).toHaveLength(2);
      // stu-1: 40+21=61, stu-2: 25+30=55
      expect(result[0].studentId).toBe('stu-1');
      expect(result[0].rank).toBe(1);
      expect(result[1].studentId).toBe('stu-2');
      expect(result[1].rank).toBe(2);
    });

    it('persists rankings via $transaction of upserts', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.studentRanking.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId_selectionCycleId: {
              studentId: 'stu-1',
              selectionCycleId: CYCLE_ID,
            },
          },
          create: expect.objectContaining({
            studentId: 'stu-1',
            selectionCycleId: CYCLE_ID,
            weightVersionId: WEIGHT_VERSION_ID,
            rank: 1,
          }),
          update: expect.objectContaining({
            rank: 1,
            weightVersionId: WEIGHT_VERSION_ID,
          }),
        }),
      );
    });

    it('recalculation updates existing records (no duplicates)', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      // First calculation
      await service.calculate(CYCLE_ID, undefined, ACTOR);
      // Second calculation (recalculation)
      await service.calculate(CYCLE_ID, undefined, ACTOR);

      // Uses upsert both times — no duplicates possible
      expect(mockPrisma.studentRanking.upsert).toHaveBeenCalledTimes(2);
    });

    it('logs RANKING_CALCULATION_STARTED and COMPLETED', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      const actions = mockAudit.log.mock.calls.map(
        (c: unknown[]) => (c[0] as { action: string }).action,
      );
      expect(actions).toContain('RANKING_CALCULATION_STARTED');
      expect(actions).toContain('RANKING_CALCULATION_COMPLETED');
    });

    it('logs RANKING_TIE_RESOLVED when ties exist', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
        { studentId: 'stu-2', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      const tieActions = mockAudit.log.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { action: string }).action === 'RANKING_TIE_RESOLVED',
      );
      expect(tieActions.length).toBe(1);
    });

    it('does not log RANKING_TIE_RESOLVED when no ties', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
        { studentId: 'stu-2', parameterKey: 'coding', weightedScore: 40 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      const tieActions = mockAudit.log.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { action: string }).action === 'RANKING_TIE_RESOLVED',
      );
      expect(tieActions.length).toBe(0);
    });

    it('preserves weightVersionId in ranking result', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(mockPrisma.studentRanking.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            weightVersionId: WEIGHT_VERSION_ID,
          }),
        }),
      );
    });

    it('includes cycle students with no score records at totalScore 0', async () => {
      setupValidContext();
      mockPrisma.studentScore.findMany.mockResolvedValue([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      setupCycleStudents(['stu-1', 'stu-no-scores']);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      const result = await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(result).toHaveLength(2);
      expect(result[0].studentId).toBe('stu-1');
      expect(result[0].rank).toBe(1);
      expect(result[1].studentId).toBe('stu-no-scores');
      expect(result[1].rank).toBe(2);
    });

    it('ranks multiple zero-score students deterministically by studentId', async () => {
      setupValidContext();
      mockPrisma.studentScore.findMany.mockResolvedValue([]);
      setupCycleStudents(['stu-c', 'stu-a', 'stu-b']);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      const result = await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(result).toHaveLength(3);
      expect(result[0].studentId).toBe('stu-a');
      expect(result[1].studentId).toBe('stu-b');
      expect(result[2].studentId).toBe('stu-c');
    });

    it('does not query EligibilityResult during ranking', async () => {
      setupValidContext();
      setupScores([
        { studentId: 'stu-1', parameterKey: 'coding', weightedScore: 50 },
      ]);
      mockPrisma.studentRanking.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, undefined, ACTOR);

      expect(mockPrisma).not.toHaveProperty('eligibilityResult.findMany');
      const prismaKeys = Object.keys(mockPrisma);
      const eligibilityCalls = prismaKeys.filter((k) =>
        k.toLowerCase().includes('eligibility'),
      );
      expect(eligibilityCalls).toEqual([]);
    });
  });

  // ──────────────────────────────────────────
  // getLiveRanking
  // ──────────────────────────────────────────

  describe('getLiveRanking', () => {
    it('returns rankings ordered by rank ascending', async () => {
      mockPrisma.studentRanking.findMany.mockResolvedValue([
        {
          studentId: 'stu-1',
          selectionCycleId: CYCLE_ID,
          rank: 1,
          percentile: 50,
          calculatedAt: new Date(),
        },
        {
          studentId: 'stu-2',
          selectionCycleId: CYCLE_ID,
          rank: 2,
          percentile: 0,
          calculatedAt: new Date(),
        },
      ]);
      mockPrisma.studentRanking.count.mockResolvedValue(2);

      const result = await service.getLiveRanking(CYCLE_ID);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].rank).toBe(1);
      expect(result.data[1].rank).toBe(2);
      expect(result.total).toBe(2);
    });

    it('supports pagination', async () => {
      mockPrisma.studentRanking.findMany.mockResolvedValue([]);
      mockPrisma.studentRanking.count.mockResolvedValue(100);

      await service.getLiveRanking(CYCLE_ID, 2, 25);

      expect(mockPrisma.studentRanking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25,
          take: 25,
        }),
      );
    });
  });

  // ──────────────────────────────────────────
  // getStudentRank
  // ──────────────────────────────────────────

  describe('getStudentRank', () => {
    it('returns ranking for a specific student', async () => {
      mockPrisma.studentRanking.findUnique.mockResolvedValue({
        studentId: 'stu-1',
        selectionCycleId: CYCLE_ID,
        rank: 3,
        percentile: 70,
        calculatedAt: new Date(),
      });

      const result = await service.getStudentRank('stu-1', CYCLE_ID);

      expect(result).not.toBeNull();
      expect(result!.rank).toBe(3);
      expect(result!.percentile).toBe(70);
    });

    it('returns null when student has no ranking', async () => {
      mockPrisma.studentRanking.findUnique.mockResolvedValue(null);

      const result = await service.getStudentRank('nonexistent', CYCLE_ID);
      expect(result).toBeNull();
    });
  });
});
