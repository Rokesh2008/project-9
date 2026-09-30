import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScoringService } from '../src/member1/scoring/scoring.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockPrisma = {
  selectionCycle: { findUnique: jest.fn() },
  student: { findUnique: jest.fn() },
  cycleConfig: { findUnique: jest.fn() },
  weightVersion: { findUnique: jest.fn() },
  studentScore: { upsert: jest.fn(), findMany: jest.fn() },
  scoreAuditLog: { create: jest.fn() },
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(ScoringService);
  });

  const CYCLE_ID = 'cycle-001';
  const STUDENT_ID = 'student-001';
  const WEIGHT_VERSION_ID = 'wv-001';
  const ACTOR = 'admin-001';

  function setupValidContext() {
    mockPrisma.selectionCycle.findUnique.mockResolvedValue({
      id: CYCLE_ID,
      code: 'C-2026',
    });
    mockPrisma.student.findUnique.mockResolvedValue({
      id: STUDENT_ID,
      name: 'Test Student',
    });
    mockPrisma.cycleConfig.findUnique.mockResolvedValue({
      selectionCycleId: CYCLE_ID,
      activeWeightVersionId: WEIGHT_VERSION_ID,
    });
    mockPrisma.weightVersion.findUnique.mockResolvedValue({
      id: WEIGHT_VERSION_ID,
      version: 1,
      selectionCycleId: CYCLE_ID,
      weights: [
        {
          parameterKey: 'coding',
          parameterLabel: 'Coding Score',
          weight: 0.5,
          maxRawScore: 100,
          sortOrder: 1,
        },
        {
          parameterKey: 'aptitude',
          parameterLabel: 'Aptitude Score',
          weight: 0.3,
          maxRawScore: 100,
          sortOrder: 2,
        },
        {
          parameterKey: 'cgpa',
          parameterLabel: 'CGPA',
          weight: 0.2,
          maxRawScore: 10,
          sortOrder: 3,
        },
      ],
    });
    mockPrisma.studentScore.upsert.mockResolvedValue({});
  }

  describe('calculateStudentScores', () => {
    it('calculates and persists scores for valid inputs', async () => {
      setupValidContext();

      const result = await service.calculateStudentScores(
        CYCLE_ID,
        STUDENT_ID,
        [
          { parameterKey: 'coding', rawScore: 80 },
          { parameterKey: 'aptitude', rawScore: 70 },
          { parameterKey: 'cgpa', rawScore: 8.5 },
        ],
        ACTOR,
      );

      expect(result.studentId).toBe(STUDENT_ID);
      expect(result.selectionCycleId).toBe(CYCLE_ID);
      expect(result.weightVersionId).toBe(WEIGHT_VERSION_ID);
      expect(result.parameterScores).toHaveLength(3);
      expect(result.totalScore).toBeCloseTo(80 * 0.5 + 70 * 0.3 + 8.5 * 0.2);

      expect(mockPrisma.studentScore.upsert).toHaveBeenCalledTimes(3);
    });

    it('handles missing parameters with isMissing=true', async () => {
      setupValidContext();

      const result = await service.calculateStudentScores(
        CYCLE_ID,
        STUDENT_ID,
        [{ parameterKey: 'coding', rawScore: 80 }],
        ACTOR,
      );

      const aptitude = result.parameterScores.find(
        (p) => p.parameterKey === 'aptitude',
      )!;
      expect(aptitude.rawScore).toBe(0);
      expect(aptitude.isMissing).toBe(true);
      expect(aptitude.weightedScore).toBe(0);

      expect(result.totalScore).toBe(40);
    });

    it('rejects duplicate parameter keys', async () => {
      setupValidContext();

      await expect(
        service.calculateStudentScores(
          CYCLE_ID,
          STUDENT_ID,
          [
            { parameterKey: 'coding', rawScore: 80 },
            { parameterKey: 'coding', rawScore: 90 },
          ],
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects NaN rawScore', async () => {
      setupValidContext();

      await expect(
        service.calculateStudentScores(
          CYCLE_ID,
          STUDENT_ID,
          [{ parameterKey: 'coding', rawScore: NaN }],
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects Infinity rawScore', async () => {
      setupValidContext();

      await expect(
        service.calculateStudentScores(
          CYCLE_ID,
          STUDENT_ID,
          [{ parameterKey: 'coding', rawScore: Infinity }],
          ACTOR,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if cycle does not exist', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.calculateStudentScores(
          'nonexistent',
          STUDENT_ID,
          [{ parameterKey: 'coding', rawScore: 80 }],
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if student does not exist', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({
        id: CYCLE_ID,
      });
      mockPrisma.student.findUnique.mockResolvedValue(null);

      await expect(
        service.calculateStudentScores(
          CYCLE_ID,
          'nonexistent',
          [{ parameterKey: 'coding', rawScore: 80 }],
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('uses upsert for idempotent score persistence', async () => {
      setupValidContext();

      await service.calculateStudentScores(
        CYCLE_ID,
        STUDENT_ID,
        [{ parameterKey: 'coding', rawScore: 80 }],
        ACTOR,
      );

      expect(mockPrisma.studentScore.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId_selectionCycleId_weightVersionId_parameterKey: {
              studentId: STUDENT_ID,
              selectionCycleId: CYCLE_ID,
              weightVersionId: WEIGHT_VERSION_ID,
              parameterKey: 'coding',
            },
          },
          create: expect.objectContaining({
            studentId: STUDENT_ID,
            selectionCycleId: CYCLE_ID,
            weightVersionId: WEIGHT_VERSION_ID,
            parameterKey: 'coding',
            rawScore: 80,
            isMissing: false,
          }),
          update: expect.objectContaining({
            rawScore: 80,
            isMissing: false,
          }),
        }),
      );
    });

    it('logs audit events for score calculation', async () => {
      setupValidContext();

      await service.calculateStudentScores(
        CYCLE_ID,
        STUDENT_ID,
        [
          { parameterKey: 'coding', rawScore: 80 },
          { parameterKey: 'aptitude', rawScore: 70 },
          { parameterKey: 'cgpa', rawScore: 8.5 },
        ],
        ACTOR,
      );

      const actions = mockAudit.log.mock.calls.map(
        (c: unknown[]) => (c[0] as { action: string }).action,
      );
      expect(actions).toContain('SCORE_CALCULATION_STARTED');
      expect(actions).toContain('SCORE_CALCULATION_COMPLETED');
    });

    it('logs audit events for missing parameters', async () => {
      setupValidContext();

      await service.calculateStudentScores(
        CYCLE_ID,
        STUDENT_ID,
        [{ parameterKey: 'coding', rawScore: 80 }],
        ACTOR,
      );

      const missingLogs = mockAudit.log.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { action: string }).action === 'SCORE_MISSING_PARAMETER',
      );
      expect(missingLogs.length).toBe(2);
    });

    it('logs audit for invalid input rejection', async () => {
      setupValidContext();

      await expect(
        service.calculateStudentScores(
          CYCLE_ID,
          STUDENT_ID,
          [{ parameterKey: 'coding', rawScore: NaN }],
          ACTOR,
        ),
      ).rejects.toThrow();

      const invalidLogs = mockAudit.log.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { action: string }).action === 'SCORE_INVALID_INPUT',
      );
      expect(invalidLogs.length).toBe(1);
    });
  });

  describe('loadActiveWeights', () => {
    it('loads the active weight version with parameters', async () => {
      setupValidContext();

      const { weightVersion, weightConfigs } =
        await service.loadActiveWeights(CYCLE_ID);

      expect(weightVersion.id).toBe(WEIGHT_VERSION_ID);
      expect(weightVersion.version).toBe(1);
      expect(weightConfigs).toHaveLength(3);
      expect(weightConfigs[0].parameterKey).toBe('coding');
      expect(weightConfigs[0].weight).toBe(0.5);
    });

    it('throws NotFoundException if no CycleConfig exists', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue(null);

      await expect(service.loadActiveWeights(CYCLE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if no active weight version is set', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: null,
      });

      await expect(service.loadActiveWeights(CYCLE_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if weight version record is missing', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: 'deleted-wv',
      });
      mockPrisma.weightVersion.findUnique.mockResolvedValue(null);

      await expect(service.loadActiveWeights(CYCLE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if weight version has no parameters', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        activeWeightVersionId: WEIGHT_VERSION_ID,
      });
      mockPrisma.weightVersion.findUnique.mockResolvedValue({
        id: WEIGHT_VERSION_ID,
        version: 1,
        weights: [],
      });

      await expect(service.loadActiveWeights(CYCLE_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getStudentScores', () => {
    it('returns null when no scores exist', async () => {
      mockPrisma.studentScore.findMany.mockResolvedValue([]);
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        activeWeightVersionId: WEIGHT_VERSION_ID,
      });

      const result = await service.getStudentScores(
        STUDENT_ID,
        CYCLE_ID,
      );
      expect(result).toBeNull();
    });

    it('returns scores with total when they exist', async () => {
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        activeWeightVersionId: WEIGHT_VERSION_ID,
      });
      mockPrisma.studentScore.findMany.mockResolvedValue([
        {
          weightVersionId: WEIGHT_VERSION_ID,
          parameterKey: 'coding',
          rawScore: 80,
          isMissing: false,
          normalizedScore: 80,
          weight: 0.5,
          weightedScore: 40,
        },
        {
          weightVersionId: WEIGHT_VERSION_ID,
          parameterKey: 'aptitude',
          rawScore: 70,
          isMissing: false,
          normalizedScore: 70,
          weight: 0.3,
          weightedScore: 21,
        },
      ]);

      const result = await service.getStudentScores(
        STUDENT_ID,
        CYCLE_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeCloseTo(61);
      expect(result!.parameterScores).toHaveLength(2);
      expect(result!.weightVersionId).toBe(WEIGHT_VERSION_ID);
    });

    it('filters by specific weightVersionId when provided', async () => {
      const specificVersionId = 'wv-002';
      mockPrisma.studentScore.findMany.mockResolvedValue([
        {
          weightVersionId: specificVersionId,
          parameterKey: 'coding',
          rawScore: 90,
          isMissing: false,
          normalizedScore: 90,
          weight: 0.4,
          weightedScore: 36,
        },
      ]);

      const result = await service.getStudentScores(
        STUDENT_ID,
        CYCLE_ID,
        specificVersionId,
      );

      expect(result).not.toBeNull();
      expect(result!.weightVersionId).toBe(specificVersionId);
      expect(mockPrisma.studentScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            weightVersionId: specificVersionId,
          }),
        }),
      );
    });
  });
});
