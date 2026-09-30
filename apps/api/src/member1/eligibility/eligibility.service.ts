import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { EligibilityResultContract } from '../../common/contracts/member1.contract';
import {
  evaluateEligibility,
  validateRuleConfiguration,
  type RuleConfiguration,
  type StudentContext,
  type EligibilityEvaluationResult,
} from './eligibility.engine';

@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────
  // Rule version CRUD
  // ──────────────────────────────────────────

  async createRuleVersion(params: {
    selectionCycleId: string;
    rules: RuleConfiguration['rules'];
    logic?: RuleConfiguration['logic'];
    description?: string;
    actorId: string;
  }) {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: params.selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const config: RuleConfiguration = {
      rules: params.rules,
      logic: params.logic ?? 'AND',
    };

    const validationErrors = validateRuleConfiguration(config);
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors);
    }

    const latestVersion = await this.prisma.eligibilityRuleVersion.findFirst({
      where: { selectionCycleId: params.selectionCycleId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const ruleVersion = await this.prisma.eligibilityRuleVersion.create({
      data: {
        selectionCycleId: params.selectionCycleId,
        version: nextVersion,
        rules: config as unknown as Prisma.InputJsonValue,
        description: params.description ?? null,
        createdBy: params.actorId,
        isActive: false,
      },
    });

    await this.audit.log({
      selectionCycleId: params.selectionCycleId,
      action: 'ELIGIBILITY_RULE_VERSION_CREATED',
      actor: params.actorId,
      entityType: 'EligibilityRuleVersion',
      entityId: ruleVersion.id,
      newValue: {
        version: nextVersion,
        ruleCount: config.rules.length,
        logic: config.logic,
      },
    });

    return ruleVersion;
  }

  async activateRuleVersion(params: {
    selectionCycleId: string;
    ruleVersionId: string;
    actorId: string;
  }) {
    const ruleVersion = await this.prisma.eligibilityRuleVersion.findUnique({
      where: { id: params.ruleVersionId },
    });
    if (!ruleVersion) {
      throw new NotFoundException('Rule version not found');
    }
    if (ruleVersion.selectionCycleId !== params.selectionCycleId) {
      throw new BadRequestException(
        'Rule version does not belong to this selection cycle',
      );
    }

    await this.prisma.eligibilityRuleVersion.updateMany({
      where: { selectionCycleId: params.selectionCycleId, isActive: true },
      data: { isActive: false },
    });

    await this.prisma.eligibilityRuleVersion.update({
      where: { id: params.ruleVersionId },
      data: { isActive: true },
    });

    const cycleConfig = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId: params.selectionCycleId },
    });
    const previousRuleVersionId = cycleConfig?.eligibilityRuleVersionId ?? null;
    if (cycleConfig) {
      await this.prisma.cycleConfig.update({
        where: { selectionCycleId: params.selectionCycleId },
        data: { eligibilityRuleVersionId: params.ruleVersionId },
      });
    }

    await this.audit.log({
      selectionCycleId: params.selectionCycleId,
      action: 'ELIGIBILITY_RULE_VERSION_ACTIVATED',
      actor: params.actorId,
      entityType: 'EligibilityRuleVersion',
      entityId: params.ruleVersionId,
      previousValue: previousRuleVersionId
        ? { eligibilityRuleVersionId: previousRuleVersionId }
        : undefined,
      newValue: {
        eligibilityRuleVersionId: params.ruleVersionId,
        version: ruleVersion.version,
      },
    });

    return ruleVersion;
  }

  async getRuleVersions(selectionCycleId: string) {
    return this.prisma.eligibilityRuleVersion.findMany({
      where: { selectionCycleId },
      orderBy: { version: 'desc' },
    });
  }

  async getRuleVersion(ruleVersionId: string) {
    const rv = await this.prisma.eligibilityRuleVersion.findUnique({
      where: { id: ruleVersionId },
    });
    if (!rv) throw new NotFoundException('Rule version not found');
    return rv;
  }

  // ──────────────────────────────────────────
  // Student context assembly
  // ──────────────────────────────────────────

  async assembleStudentContext(
    studentId: string,
    selectionCycleId?: string,
  ): Promise<StudentContext> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        assessmentResults: true,
        batch: true,
        credentials: {
          where: { verificationStatus: 'VERIFIED' },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const preferences = selectionCycleId && this.prisma.studentPreference?.findMany
      ? await this.prisma.studentPreference.findMany({
          where: { studentId, selectionCycleId },
          orderBy: { preferenceRank: 'asc' },
          include: { domain: true },
        })
      : [];
    const credentials = student.credentials ?? [];

    const context: StudentContext = {
      studentId: student.studentId,
      registerNumber: student.registerNumber,
      name: student.name,
      email: student.email,
      isActive: student.isActive,
      batchId: student.batchId,
      cgpa: student.cgpa,
      attendancePercent: student.attendancePercent,
      dsaLevel: student.dsaLevel,
      verifiedCertificates: credentials.map((c) => c.name),
      certificateCount: credentials.length,
      preferences: preferences.map((p) => p.domain.code),
      preferenceCount: preferences.length,
    };

    for (const ar of student.assessmentResults) {
      const typeKey = ar.assessmentType.toLowerCase();
      const scoreKey = `${typeKey}Score`;
      const existing = context[scoreKey];
      if (existing === undefined || (typeof existing === 'number' && ar.score > existing)) {
        context[scoreKey] = ar.score;
      }
      context[`${typeKey}MaxScore`] = ar.maxScore;
      if (ar.percentage !== null) {
        context[`${typeKey}Percentage`] = ar.percentage;
      }
    }

    return context;
  }

  // ──────────────────────────────────────────
  // Evaluation
  // ──────────────────────────────────────────

  async loadActiveRuleConfig(
    selectionCycleId: string,
    ruleVersionId?: string,
  ): Promise<{ ruleVersionId: string; config: RuleConfiguration }> {
    if (ruleVersionId) {
      const rv = await this.prisma.eligibilityRuleVersion.findUnique({
        where: { id: ruleVersionId },
      });
      if (!rv) throw new NotFoundException('Rule version not found');
      if (rv.selectionCycleId !== selectionCycleId) {
        throw new BadRequestException(
          'Rule version does not belong to this selection cycle',
        );
      }
      return { ruleVersionId: rv.id, config: rv.rules as unknown as RuleConfiguration };
    }

    const cycleConfig = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });

    const activeRuleId = cycleConfig?.eligibilityRuleVersionId;

    if (!activeRuleId) {
      const activeVersion = await this.prisma.eligibilityRuleVersion.findFirst({
        where: { selectionCycleId, isActive: true },
      });
      if (!activeVersion) {
        throw new BadRequestException(
          'No active eligibility rule version configured for this cycle',
        );
      }
      return {
        ruleVersionId: activeVersion.id,
        config: activeVersion.rules as unknown as RuleConfiguration,
      };
    }

    const rv = await this.prisma.eligibilityRuleVersion.findUnique({
      where: { id: activeRuleId },
    });
    if (!rv) {
      throw new NotFoundException(
        'Active eligibility rule version not found in database',
      );
    }
    return { ruleVersionId: rv.id, config: rv.rules as unknown as RuleConfiguration };
  }

  async evaluateStudent(
    studentId: string,
    selectionCycleId: string,
    ruleVersionId: string,
    config: RuleConfiguration,
    actorId: string,
  ): Promise<EligibilityResultContract> {
    const context = await this.assembleStudentContext(studentId, selectionCycleId);

    let result: EligibilityEvaluationResult;
    try {
      result = evaluateEligibility(context, config);
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'ELIGIBILITY_EVALUATION_FAILED',
        actor: actorId,
        entityType: 'Student',
        entityId: studentId,
        metadata: {
          ruleVersionId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    const failedRulesJson = result.failedRules.length > 0
      ? result.failedRules.map((r) => ({
          ruleId: r.ruleId,
          field: r.field,
          operator: r.operator,
          expected: r.expected,
          actual: r.actual,
          message: r.message,
        }))
      : null;

    for (const fr of result.failedRules) {
      await this.audit.log({
        selectionCycleId,
        action: 'ELIGIBILITY_RULE_FAILED',
        actor: actorId,
        entityType: 'Student',
        entityId: studentId,
        metadata: {
          ruleVersionId,
          ruleId: fr.ruleId,
          field: fr.field,
          operator: fr.operator,
          expected: fr.expected,
          actual: fr.actual,
        },
      });
    }

    await this.prisma.eligibilityResult.upsert({
      where: {
        studentId_selectionCycleId: {
          studentId,
          selectionCycleId,
        },
      },
      create: {
        studentId,
        selectionCycleId,
        ruleVersionId,
        isEligible: result.isEligible,
        failedRules: failedRulesJson
          ? (failedRulesJson as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      update: {
        ruleVersionId,
        isEligible: result.isEligible,
        failedRules: failedRulesJson
          ? (failedRulesJson as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        evaluatedAt: new Date(),
      },
    });

    return {
      studentId,
      selectionCycleId,
      isEligible: result.isEligible,
      failedRules: result.failedRules.map((r) => r.message),
      evaluatedAt: new Date(),
    };
  }

  async evaluate(
    selectionCycleId: string,
    ruleVersionId?: string,
    actorId: string = 'system',
    studentId?: string,
  ): Promise<EligibilityResultContract[]> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const { ruleVersionId: resolvedRuleVersionId, config } =
      await this.loadActiveRuleConfig(selectionCycleId, ruleVersionId);

    const validationErrors = validateRuleConfiguration(config);
    if (validationErrors.length > 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'ELIGIBILITY_INVALID_RULE_CONFIGURATION',
        actor: actorId,
        entityType: 'EligibilityRuleVersion',
        entityId: resolvedRuleVersionId,
        metadata: { errors: validationErrors },
      });
      throw new BadRequestException(
        `Invalid rule configuration: ${validationErrors.join('; ')}`,
      );
    }

    await this.audit.log({
      selectionCycleId,
      action: 'ELIGIBILITY_EVALUATION_STARTED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        ruleVersionId: resolvedRuleVersionId,
        singleStudent: studentId ?? null,
      },
    });

    let students: Array<{ id: string }>;
    if (studentId) {
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
      });
      if (!student) throw new NotFoundException('Student not found');
      students = [{ id: student.id }];
    } else {
      students = await this.prisma.student.findMany({
        where: { isActive: true },
        select: { id: true },
      });
    }

    // ── Phase 1: Compute ─────────────────────────────────────────────────────
    // Evaluate every student using the engine. No DB writes here.
    // If any student evaluation fails, we throw before persisting anything,
    // leaving the previous EligibilityResult state fully intact.
    const contracts: EligibilityResultContract[] = [];
    const upsertOps: ReturnType<typeof this.prisma.eligibilityResult.upsert>[] =
      [];

    for (const s of students) {
      const context = await this.assembleStudentContext(s.id, selectionCycleId);

      let result: EligibilityEvaluationResult;
      try {
        result = evaluateEligibility(context, config);
      } catch (err) {
        await this.audit.log({
          selectionCycleId,
          action: 'ELIGIBILITY_EVALUATION_FAILED',
          actor: actorId,
          entityType: 'Student',
          entityId: s.id,
          metadata: {
            ruleVersionId: resolvedRuleVersionId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }

      const failedRulesJson =
        result.failedRules.length > 0
          ? result.failedRules.map((r) => ({
              ruleId: r.ruleId,
              field: r.field,
              operator: r.operator,
              expected: r.expected,
              actual: r.actual,
              message: r.message,
            }))
          : null;

      for (const fr of result.failedRules) {
        await this.audit.log({
          selectionCycleId,
          action: 'ELIGIBILITY_RULE_FAILED',
          actor: actorId,
          entityType: 'Student',
          entityId: s.id,
          metadata: {
            ruleVersionId: resolvedRuleVersionId,
            ruleId: fr.ruleId,
            field: fr.field,
            operator: fr.operator,
            expected: fr.expected,
            actual: fr.actual,
          },
        });
      }

      contracts.push({
        studentId: s.id,
        selectionCycleId,
        isEligible: result.isEligible,
        failedRules: result.failedRules.map((r) => r.message),
        evaluatedAt: new Date(),
      });

      upsertOps.push(
        this.prisma.eligibilityResult.upsert({
          where: {
            studentId_selectionCycleId: {
              studentId: s.id,
              selectionCycleId,
            },
          },
          create: {
            studentId: s.id,
            selectionCycleId,
            ruleVersionId: resolvedRuleVersionId,
            isEligible: result.isEligible,
            failedRules: failedRulesJson
              ? (failedRulesJson as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
          update: {
            ruleVersionId: resolvedRuleVersionId,
            isEligible: result.isEligible,
            failedRules: failedRulesJson
              ? (failedRulesJson as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            evaluatedAt: new Date(),
          },
        }),
      );
    }

    // ── Phase 2: Persist atomically ──────────────────────────────────────────
    // All EligibilityResult upserts execute in a single transaction.
    // If the transaction fails, every write is rolled back and the previous
    // eligibility state remains intact.
    try {
      await this.prisma.$transaction(upsertOps);
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'ELIGIBILITY_EVALUATION_FAILED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          ruleVersionId: resolvedRuleVersionId,
          error: err instanceof Error ? err.message : String(err),
          phase: 'persist',
        },
      });
      throw err;
    }

    await this.audit.log({
      selectionCycleId,
      action: 'ELIGIBILITY_EVALUATION_COMPLETED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        ruleVersionId: resolvedRuleVersionId,
        totalEvaluated: contracts.length,
        eligible: contracts.filter((r) => r.isEligible).length,
        ineligible: contracts.filter((r) => !r.isEligible).length,
      },
    });

    return contracts;
  }

  async getResult(
    studentId: string,
    selectionCycleId: string,
  ): Promise<EligibilityResultContract | null> {
    const result = await this.prisma.eligibilityResult.findUnique({
      where: {
        studentId_selectionCycleId: { studentId, selectionCycleId },
      },
    });
    if (!result) return null;

    const failedRulesRaw = result.failedRules as unknown as Array<{
      message: string;
    }> | null;

    return {
      studentId: result.studentId,
      selectionCycleId: result.selectionCycleId,
      isEligible: result.isEligible,
      failedRules: failedRulesRaw
        ? failedRulesRaw.map((r) => r.message)
        : undefined,
      evaluatedAt: result.evaluatedAt,
    };
  }

  async getResultsByCycle(
    selectionCycleId: string,
  ): Promise<EligibilityResultContract[]> {
    const results = await this.prisma.eligibilityResult.findMany({
      where: { selectionCycleId },
      orderBy: { evaluatedAt: 'desc' },
    });

    return results.map((r) => {
      const failedRulesRaw = r.failedRules as unknown as Array<{
        message: string;
      }> | null;

      return {
        studentId: r.studentId,
        selectionCycleId: r.selectionCycleId,
        isEligible: r.isEligible,
        failedRules: failedRulesRaw
          ? failedRulesRaw.map((fr) => fr.message)
          : undefined,
        evaluatedAt: r.evaluatedAt,
      };
    });
  }
}
