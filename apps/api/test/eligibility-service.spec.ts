import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EligibilityService } from '../src/member1/eligibility/eligibility.service';
import { AuditService } from '../src/member1/audit/audit.service';
import { PrismaService } from '../src/common/prisma.service';

const mockPrisma = {
  selectionCycle: { findUnique: jest.fn() },
  student: { findUnique: jest.fn(), findMany: jest.fn() },
  cycleConfig: { findUnique: jest.fn(), update: jest.fn() },
  eligibilityRuleVersion: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  eligibilityResult: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

describe('EligibilityService', () => {
  let service: EligibilityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EligibilityService);
  });

  const CYCLE_ID = 'cycle-001';
  const STUDENT_ID = 'student-001';
  const RULE_VERSION_ID = 'rv-001';
  const ACTOR = 'admin-001';

  const VALID_RULES = {
    logic: 'AND',
    rules: [
      { id: 'r1', field: 'codingScore', operator: 'GTE', value: 50 },
    ],
  };

  // ──────────────────────────────────────────
  // createRuleVersion
  // ──────────────────────────────────────────

  describe('createRuleVersion', () => {
    it('creates a new rule version with auto-incremented version', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.eligibilityRuleVersion.findFirst.mockResolvedValue({
        version: 2,
      });
      mockPrisma.eligibilityRuleVersion.create.mockResolvedValue({
        id: RULE_VERSION_ID,
        version: 3,
        selectionCycleId: CYCLE_ID,
        rules: VALID_RULES,
        isActive: false,
      });

      const result = await service.createRuleVersion({
        selectionCycleId: CYCLE_ID,
        rules: VALID_RULES.rules as any,
        logic: 'AND',
        actorId: ACTOR,
      });

      expect(result.version).toBe(3);
      expect(mockPrisma.eligibilityRuleVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 3 }),
        }),
      );
    });

    it('starts at version 1 when no prior versions exist', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.eligibilityRuleVersion.findFirst.mockResolvedValue(null);
      mockPrisma.eligibilityRuleVersion.create.mockResolvedValue({
        id: RULE_VERSION_ID,
        version: 1,
      });

      await service.createRuleVersion({
        selectionCycleId: CYCLE_ID,
        rules: VALID_RULES.rules as any,
        actorId: ACTOR,
      });

      expect(mockPrisma.eligibilityRuleVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1 }),
        }),
      );
    });

    it('throws NotFoundException for invalid cycle', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.createRuleVersion({
          selectionCycleId: 'nonexistent',
          rules: VALID_RULES.rules as any,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects invalid rule configuration', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });

      await expect(
        service.createRuleVersion({
          selectionCycleId: CYCLE_ID,
          rules: [] as any,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('logs audit event on creation', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.eligibilityRuleVersion.findFirst.mockResolvedValue(null);
      mockPrisma.eligibilityRuleVersion.create.mockResolvedValue({
        id: RULE_VERSION_ID,
        version: 1,
      });

      await service.createRuleVersion({
        selectionCycleId: CYCLE_ID,
        rules: VALID_RULES.rules as any,
        actorId: ACTOR,
      });

      const actions = mockAudit.log.mock.calls.map(
        (c: unknown[]) => (c[0] as { action: string }).action,
      );
      expect(actions).toContain('ELIGIBILITY_RULE_VERSION_CREATED');
    });
  });

  // ──────────────────────────────────────────
  // activateRuleVersion
  // ──────────────────────────────────────────

  describe('activateRuleVersion', () => {
    it('activates a rule version and deactivates others', async () => {
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: RULE_VERSION_ID,
        selectionCycleId: CYCLE_ID,
        version: 1,
      });
      mockPrisma.eligibilityRuleVersion.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrisma.eligibilityRuleVersion.update.mockResolvedValue({
        id: RULE_VERSION_ID,
        isActive: true,
      });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
      });
      mockPrisma.cycleConfig.update.mockResolvedValue({});

      await service.activateRuleVersion({
        selectionCycleId: CYCLE_ID,
        ruleVersionId: RULE_VERSION_ID,
        actorId: ACTOR,
      });

      expect(mockPrisma.eligibilityRuleVersion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { selectionCycleId: CYCLE_ID, isActive: true },
          data: { isActive: false },
        }),
      );
      expect(mockPrisma.eligibilityRuleVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RULE_VERSION_ID },
          data: { isActive: true },
        }),
      );
    });

    it('throws NotFoundException for invalid rule version', async () => {
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.activateRuleVersion({
          selectionCycleId: CYCLE_ID,
          ruleVersionId: 'nonexistent',
          actorId: ACTOR,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if version belongs to different cycle', async () => {
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: RULE_VERSION_ID,
        selectionCycleId: 'other-cycle',
        version: 1,
      });

      await expect(
        service.activateRuleVersion({
          selectionCycleId: CYCLE_ID,
          ruleVersionId: RULE_VERSION_ID,
          actorId: ACTOR,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────
  // assembleStudentContext
  // ──────────────────────────────────────────

  describe('assembleStudentContext', () => {
    it('assembles context from student and assessment results', async () => {
      mockPrisma.student.findUnique.mockResolvedValue({
        id: STUDENT_ID,
        studentId: 'REG001',
        name: 'Test Student',
        email: 'test@uni.edu',
        isActive: true,
        batchId: 'batch-1',
        batch: { id: 'batch-1', code: 'B-2026' },
        assessmentResults: [
          {
            assessmentType: 'CODING',
            score: 85,
            maxScore: 100,
            percentage: 85,
          },
          {
            assessmentType: 'APTITUDE',
            score: 70,
            maxScore: 100,
            percentage: 70,
          },
        ],
      });

      const ctx = await service.assembleStudentContext(STUDENT_ID);

      expect(ctx.studentId).toBe('REG001');
      expect(ctx.codingScore).toBe(85);
      expect(ctx.aptitudeScore).toBe(70);
      expect(ctx.email).toBe('test@uni.edu');
      expect(ctx.isActive).toBe(true);
    });

    it('throws NotFoundException for missing student', async () => {
      mockPrisma.student.findUnique.mockResolvedValue(null);

      await expect(
        service.assembleStudentContext('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('picks highest score when multiple assessments of same type', async () => {
      mockPrisma.student.findUnique.mockResolvedValue({
        id: STUDENT_ID,
        studentId: 'REG001',
        name: 'Test',
        email: 'test@uni.edu',
        isActive: true,
        batchId: 'batch-1',
        batch: { id: 'batch-1' },
        assessmentResults: [
          { assessmentType: 'CODING', score: 60, maxScore: 100, percentage: 60 },
          { assessmentType: 'CODING', score: 85, maxScore: 100, percentage: 85 },
        ],
      });

      const ctx = await service.assembleStudentContext(STUDENT_ID);
      expect(ctx.codingScore).toBe(85);
    });
  });

  // ──────────────────────────────────────────
  // evaluate (full pipeline)
  // ──────────────────────────────────────────

  describe('evaluate', () => {
    function setupFullEvaluation() {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        eligibilityRuleVersionId: RULE_VERSION_ID,
      });
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: RULE_VERSION_ID,
        selectionCycleId: CYCLE_ID,
        version: 1,
        rules: VALID_RULES,
        isActive: true,
      });
      mockPrisma.student.findMany.mockResolvedValue([
        { id: 'stu-1' },
        { id: 'stu-2' },
      ]);
      mockPrisma.student.findUnique
        .mockResolvedValueOnce({
          id: 'stu-1',
          studentId: 'REG001',
          name: 'Alice',
          email: 'alice@uni.edu',
          isActive: true,
          batchId: 'b1',
          batch: { id: 'b1' },
          assessmentResults: [
            { assessmentType: 'CODING', score: 80, maxScore: 100, percentage: 80 },
          ],
        })
        .mockResolvedValueOnce({
          id: 'stu-2',
          studentId: 'REG002',
          name: 'Bob',
          email: 'bob@uni.edu',
          isActive: true,
          batchId: 'b1',
          batch: { id: 'b1' },
          assessmentResults: [
            { assessmentType: 'CODING', score: 30, maxScore: 100, percentage: 30 },
          ],
        });
      mockPrisma.eligibilityResult.upsert.mockResolvedValue({});
    }

    it('evaluates all active students and returns results', async () => {
      setupFullEvaluation();

      const results = await service.evaluate(CYCLE_ID, undefined, ACTOR);

      expect(results).toHaveLength(2);
      expect(results[0].isEligible).toBe(true);
      expect(results[1].isEligible).toBe(false);
    });

    it('persists results via upsert', async () => {
      setupFullEvaluation();

      await service.evaluate(CYCLE_ID, undefined, ACTOR);

      expect(mockPrisma.eligibilityResult.upsert).toHaveBeenCalledTimes(2);
    });

    it('logs ELIGIBILITY_EVALUATION_STARTED and COMPLETED', async () => {
      setupFullEvaluation();

      await service.evaluate(CYCLE_ID, undefined, ACTOR);

      const actions = mockAudit.log.mock.calls.map(
        (c: unknown[]) => (c[0] as { action: string }).action,
      );
      expect(actions).toContain('ELIGIBILITY_EVALUATION_STARTED');
      expect(actions).toContain('ELIGIBILITY_EVALUATION_COMPLETED');
    });

    it('logs ELIGIBILITY_RULE_FAILED for each failed rule on each student', async () => {
      setupFullEvaluation();

      await service.evaluate(CYCLE_ID, undefined, ACTOR);

      const failedLogs = mockAudit.log.mock.calls.filter(
        (c: unknown[]) => (c[0] as { action: string }).action === 'ELIGIBILITY_RULE_FAILED',
      );
      expect(failedLogs.length).toBe(1);
    });

    it('throws NotFoundException for nonexistent cycle', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.evaluate('nonexistent', undefined, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no active rule version', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        eligibilityRuleVersionId: null,
      });
      mockPrisma.eligibilityRuleVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.evaluate(CYCLE_ID, undefined, ACTOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('evaluates a single student when studentId is provided', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        eligibilityRuleVersionId: RULE_VERSION_ID,
      });
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: RULE_VERSION_ID,
        selectionCycleId: CYCLE_ID,
        version: 1,
        rules: VALID_RULES,
        isActive: true,
      });
      mockPrisma.student.findUnique.mockResolvedValue({
        id: 'stu-1',
        studentId: 'REG001',
        name: 'Alice',
        email: 'alice@uni.edu',
        isActive: true,
        batchId: 'b1',
        batch: { id: 'b1' },
        assessmentResults: [
          { assessmentType: 'CODING', score: 80, maxScore: 100, percentage: 80 },
        ],
      });
      mockPrisma.eligibilityResult.upsert.mockResolvedValue({});

      const results = await service.evaluate(CYCLE_ID, undefined, ACTOR, 'stu-1');

      expect(results).toHaveLength(1);
      expect(results[0].isEligible).toBe(true);
    });

    it('logs ELIGIBILITY_INVALID_RULE_CONFIGURATION for bad stored config', async () => {
      mockPrisma.selectionCycle.findUnique.mockResolvedValue({ id: CYCLE_ID });
      mockPrisma.cycleConfig.findUnique.mockResolvedValue({
        selectionCycleId: CYCLE_ID,
        eligibilityRuleVersionId: RULE_VERSION_ID,
      });
      mockPrisma.eligibilityRuleVersion.findUnique.mockResolvedValue({
        id: RULE_VERSION_ID,
        selectionCycleId: CYCLE_ID,
        version: 1,
        rules: { logic: 'AND', rules: [] },
        isActive: true,
      });

      await expect(
        service.evaluate(CYCLE_ID, undefined, ACTOR),
      ).rejects.toThrow(BadRequestException);

      const invalidLogs = mockAudit.log.mock.calls.filter(
        (c: unknown[]) =>
          (c[0] as { action: string }).action === 'ELIGIBILITY_INVALID_RULE_CONFIGURATION',
      );
      expect(invalidLogs.length).toBe(1);
    });
  });

  // ──────────────────────────────────────────
  // getResult / getResultsByCycle
  // ──────────────────────────────────────────

  describe('getResult', () => {
    it('returns null when no result exists', async () => {
      mockPrisma.eligibilityResult.findUnique.mockResolvedValue(null);

      const result = await service.getResult(STUDENT_ID, CYCLE_ID);
      expect(result).toBeNull();
    });

    it('returns contract-shaped result when exists', async () => {
      mockPrisma.eligibilityResult.findUnique.mockResolvedValue({
        studentId: STUDENT_ID,
        selectionCycleId: CYCLE_ID,
        isEligible: false,
        failedRules: [
          { ruleId: 'r1', field: 'cgpa', operator: 'GTE', expected: 6, actual: 4, message: 'cgpa GTE 6: failed (actual: 4)' },
        ],
        evaluatedAt: new Date('2026-09-29T10:00:00Z'),
      });

      const result = await service.getResult(STUDENT_ID, CYCLE_ID);
      expect(result).not.toBeNull();
      expect(result!.isEligible).toBe(false);
      expect(result!.failedRules).toHaveLength(1);
      expect(result!.failedRules![0]).toContain('cgpa');
    });
  });

  describe('getResultsByCycle', () => {
    it('returns all results for a cycle', async () => {
      mockPrisma.eligibilityResult.findMany.mockResolvedValue([
        {
          studentId: 'stu-1',
          selectionCycleId: CYCLE_ID,
          isEligible: true,
          failedRules: null,
          evaluatedAt: new Date(),
        },
        {
          studentId: 'stu-2',
          selectionCycleId: CYCLE_ID,
          isEligible: false,
          failedRules: [{ message: 'failed' }],
          evaluatedAt: new Date(),
        },
      ]);

      const results = await service.getResultsByCycle(CYCLE_ID);
      expect(results).toHaveLength(2);
      expect(results[0].isEligible).toBe(true);
      expect(results[0].failedRules).toBeUndefined();
      expect(results[1].isEligible).toBe(false);
      expect(results[1].failedRules).toHaveLength(1);
    });
  });
});
