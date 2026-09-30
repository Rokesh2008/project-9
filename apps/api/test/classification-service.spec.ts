import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClassificationService } from '../src/member1/classification/classification.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockPrisma = {
  selectionCycle: { findUnique: jest.fn() },
  cycleConfig: { findUnique: jest.fn() },
  studentRanking: { findMany: jest.fn() },
  eligibilityResult: { findMany: jest.fn() },
  freezeSchedule: { findFirst: jest.fn() },
  rankingSnapshot: { findFirst: jest.fn() },
  rankingSnapshotEntry: { findMany: jest.fn(), count: jest.fn() },
  hopePepClassification: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      async (promises: Promise<unknown>[]) => {
        return Promise.all(promises);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(ClassificationService);
  });

  const CYCLE_ID = 'cycle-001';
  const ACTOR = 'admin-001';

  function setupValidCycle() {
    mockPrisma.selectionCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      code: 'C-2026',
    });
    mockPrisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      hopeCount: 2,
      pepCount: 3,
    });
    mockPrisma.freezeSchedule.findFirst.mockResolvedValue(null);
  }

  function setupRankings(
    rankings: Array<{ studentId: string; rank: number }>,
  ) {
    mockPrisma.studentRanking.findMany.mockResolvedValue(
      rankings.map((r) => ({
        studentId: r.studentId,
        selectionCycleId: CYCLE_ID,
        rank: r.rank,
        totalScore: 100 - r.rank,
      })),
    );
  }

  function setupEligibility(
    results: Array<{ studentId: string; isEligible: boolean }>,
  ) {
    mockPrisma.eligibilityResult.findMany.mockResolvedValue(
      results.map((r) => ({
        studentId: r.studentId,
        selectionCycleId: CYCLE_ID,
        isEligible: r.isEligible,
      })),
    );
  }

  // ──────────────────────────────────────────
  // calculate
  // ──────────────────────────────────────────

  describe('calculate', () => {
    it('throws NotFoundException for missing cycle', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.calculate('nonexistent', ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for missing CycleConfig', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
      });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.calculate(CYCLE_ID, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when no rankings exist', async () => {
      setupValidCycle();
      setupRankings([]);
      setupEligibility([]);

      const result = await service.calculate(CYCLE_ID, ACTOR);
      expect(result).toEqual([]);
    });

    it('classifies students using ranking + eligibility', async () => {
      setupValidCycle();
      setupRankings([
        { studentId: 'stu-1', rank: 1 },
        { studentId: 'stu-2', rank: 2 },
        { studentId: 'stu-3', rank: 3 },
        { studentId: 'stu-4', rank: 4 },
        { studentId: 'stu-5', rank: 5 },
      ]);
      setupEligibility([
        { studentId: 'stu-1', isEligible: true },
        { studentId: 'stu-2', isEligible: true },
        { studentId: 'stu-3', isEligible: true },
        { studentId: 'stu-4', isEligible: true },
        { studentId: 'stu-5', isEligible: false },
      ]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      const result = await service.calculate(CYCLE_ID, ACTOR);

      expect(result).toHaveLength(5);
      expect(result[0].program).toBe('HOPE');
      expect(result[1].program).toBe('HOPE');
      expect(result[2].program).toBe('PEP');
      expect(result[3].program).toBe('PEP');
      expect(result[4].program).toBe('NOT_ELIGIBLE');
    });

    it('student with no eligibility result is classified as NOT_ELIGIBLE', async () => {
      setupValidCycle();
      setupRankings([
        { studentId: 'stu-1', rank: 1 },
        { studentId: 'stu-2', rank: 2 },
      ]);
      setupEligibility([
        { studentId: 'stu-1', isEligible: true },
      ]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      const result = await service.calculate(CYCLE_ID, ACTOR);

      expect(result[0].program).toBe('HOPE');
      expect(result[1].program).toBe('NOT_ELIGIBLE');
    });

    it('persists classifications via $transaction of upserts', async () => {
      setupValidCycle();
      setupRankings([{ studentId: 'stu-1', rank: 1 }]);
      setupEligibility([{ studentId: 'stu-1', isEligible: true }]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, ACTOR);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.hopePepClassification.upsert).toHaveBeenCalledWith(
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
            program: 'HOPE',
            rank: 1,
            status: 'CLASSIFIED',
          }),
        }),
      );
    });

    it('recalculation updates existing records (idempotent upsert)', async () => {
      setupValidCycle();
      setupRankings([{ studentId: 'stu-1', rank: 1 }]);
      setupEligibility([{ studentId: 'stu-1', isEligible: true }]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, ACTOR);
      await service.calculate(CYCLE_ID, ACTOR);

      expect(mockPrisma.hopePepClassification.upsert).toHaveBeenCalledTimes(2);
    });

    it('logs CLASSIFICATION_CALCULATION_STARTED and COMPLETED', async () => {
      setupValidCycle();
      setupRankings([{ studentId: 'stu-1', rank: 1 }]);
      setupEligibility([{ studentId: 'stu-1', isEligible: true }]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, ACTOR);

      const actions = mockAudit.log.mock.calls.map(
        (c: unknown[]) => (c[0] as { action: string }).action,
      );
      expect(actions).toContain('CLASSIFICATION_CALCULATION_STARTED');
      expect(actions).toContain('CLASSIFICATION_CALCULATION_COMPLETED');
    });

    it('COMPLETED audit includes classification counts', async () => {
      setupValidCycle();
      setupRankings([
        { studentId: 'stu-1', rank: 1 },
        { studentId: 'stu-2', rank: 2 },
        { studentId: 'stu-3', rank: 3 },
      ]);
      setupEligibility([
        { studentId: 'stu-1', isEligible: true },
        { studentId: 'stu-2', isEligible: true },
        { studentId: 'stu-3', isEligible: false },
      ]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, ACTOR);

      const completedCall = mockAudit.log.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { action: string }).action ===
          'CLASSIFICATION_CALCULATION_COMPLETED',
      );
      const metadata = (completedCall![0] as { metadata: Record<string, unknown> })
        .metadata;
      expect(metadata.hopeClassified).toBe(2);
      expect(metadata.pepClassified).toBe(0);
      expect(metadata.notEligibleCount).toBe(1);
      expect(metadata.totalStudents).toBe(3);
    });

    it('does not modify StudentRanking table', async () => {
      setupValidCycle();
      setupRankings([{ studentId: 'stu-1', rank: 1 }]);
      setupEligibility([{ studentId: 'stu-1', isEligible: true }]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      await service.calculate(CYCLE_ID, ACTOR);

      const rankingKeys = Object.keys(mockPrisma.studentRanking);
      for (const key of rankingKeys) {
        if (key !== 'findMany') {
          const fn = (mockPrisma.studentRanking as Record<string, jest.Mock>)[key];
          if (fn && typeof fn.mock !== 'undefined') {
            expect(fn).not.toHaveBeenCalled();
          }
        }
      }
    });

    it('throws ConflictException when freeze has been executed', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
      });
      mockPrisma.freezeSchedule.findFirst.mockResolvedValue({
        id: 'fs-1',
        status: 'EXECUTED',
        snapshotId: 'snap-1',
      });

      await expect(
        service.calculate(CYCLE_ID, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('changed boundary on recalculation changes classification', async () => {
      setupValidCycle();
      setupRankings([
        { studentId: 'stu-1', rank: 1 },
        { studentId: 'stu-2', rank: 2 },
      ]);
      setupEligibility([
        { studentId: 'stu-1', isEligible: true },
        { studentId: 'stu-2', isEligible: true },
      ]);
      mockPrisma.hopePepClassification.upsert.mockResolvedValue({});

      // First calc: hopeCount=2, pepCount=3
      const result1 = await service.calculate(CYCLE_ID, ACTOR);
      expect(result1[0].program).toBe('HOPE');
      expect(result1[1].program).toBe('HOPE');

      // Change config to hopeCount=1
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        hopeCount: 1,
        pepCount: 3,
      });

      const result2 = await service.calculate(CYCLE_ID, ACTOR);
      expect(result2[0].program).toBe('HOPE');
      expect(result2[1].program).toBe('PEP');
    });
  });

  // ──────────────────────────────────────────
  // getClassifications
  // ──────────────────────────────────────────

  describe('getClassifications', () => {
    it('returns classifications ordered by rank', async () => {
      mockPrisma.hopePepClassification.findMany.mockResolvedValue([
        {
          studentId: 'stu-1',
          selectionCycleId: CYCLE_ID,
          program: 'HOPE',
          rank: 1,
          status: 'CLASSIFIED',
          classifiedAt: new Date(),
        },
        {
          studentId: 'stu-2',
          selectionCycleId: CYCLE_ID,
          program: 'PEP',
          rank: 2,
          status: 'CLASSIFIED',
          classifiedAt: new Date(),
        },
      ]);
      mockPrisma.hopePepClassification.count.mockResolvedValue(2);

      const result = await service.getClassifications(CYCLE_ID);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].program).toBe('HOPE');
      expect(result.data[1].program).toBe('PEP');
      expect(result.total).toBe(2);
    });

    it('supports pagination', async () => {
      mockPrisma.hopePepClassification.findMany.mockResolvedValue([]);
      mockPrisma.hopePepClassification.count.mockResolvedValue(100);

      await service.getClassifications(CYCLE_ID, 2, 25);

      expect(mockPrisma.hopePepClassification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 25,
          take: 25,
        }),
      );
    });
  });

  // ──────────────────────────────────────────
  // getStudentClassification
  // ──────────────────────────────────────────

  describe('getStudentClassification', () => {
    it('returns classification for a specific student', async () => {
      mockPrisma.hopePepClassification.findUnique.mockResolvedValue({
        studentId: 'stu-1',
        selectionCycleId: CYCLE_ID,
        program: 'HOPE',
        rank: 1,
        status: 'CLASSIFIED',
        classifiedAt: new Date(),
      });

      const result = await service.getStudentClassification(
        'stu-1',
        CYCLE_ID,
      );

      expect(result).not.toBeNull();
      expect(result!.program).toBe('HOPE');
      expect(result!.rank).toBe(1);
    });

    it('returns null when student has no classification', async () => {
      mockPrisma.hopePepClassification.findUnique.mockResolvedValue(null);

      const result = await service.getStudentClassification(
        'nonexistent',
        CYCLE_ID,
      );
      expect(result).toBeNull();
    });
  });
});
