import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  computeStudentScores,
  computeTotalScore,
  validateParameterInputs,
  type ParameterScoreInput,
  type ParameterWeightConfig,
  type ScoreCalculationResult,
} from './scoring.engine';

@Injectable()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async calculateStudentScores(
    selectionCycleId: string,
    studentId: string,
    parameterScores: ParameterScoreInput[],
    actorId: string,
  ): Promise<ScoreCalculationResult> {
    const validationErrors = validateParameterInputs(parameterScores);
    if (validationErrors.length > 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'SCORE_INVALID_INPUT',
        actor: actorId,
        entityType: 'Student',
        entityId: studentId,
        metadata: { errors: validationErrors },
      });
      throw new BadRequestException(validationErrors);
    }

    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const { weightVersion, weightConfigs } =
      await this.loadActiveWeights(selectionCycleId);

    await this.audit.log({
      selectionCycleId,
      action: 'SCORE_CALCULATION_STARTED',
      actor: actorId,
      entityType: 'Student',
      entityId: studentId,
      metadata: {
        weightVersionId: weightVersion.id,
        inputParameterCount: parameterScores.length,
        configuredParameterCount: weightConfigs.length,
      },
    });

    const inputKeySet = new Set(
      parameterScores
        .filter(
          (p) => p.rawScore !== null && p.rawScore !== undefined,
        )
        .map((p) => p.parameterKey),
    );
    for (const wc of weightConfigs) {
      if (!inputKeySet.has(wc.parameterKey)) {
        await this.audit.log({
          selectionCycleId,
          action: 'SCORE_MISSING_PARAMETER',
          actor: actorId,
          entityType: 'Student',
          entityId: studentId,
          metadata: {
            parameterKey: wc.parameterKey,
            weightVersionId: weightVersion.id,
          },
        });
      }
    }

    let result: ScoreCalculationResult;
    try {
      result = computeStudentScores(
        studentId,
        selectionCycleId,
        weightVersion.id,
        parameterScores,
        weightConfigs,
      );
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'SCORE_CALCULATION_FAILURE',
        actor: actorId,
        entityType: 'Student',
        entityId: studentId,
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    for (const ps of result.parameterScores) {
      await this.prisma.studentScore.upsert({
        where: {
          studentId_selectionCycleId_weightVersionId_parameterKey: {
            studentId,
            selectionCycleId,
            weightVersionId: weightVersion.id,
            parameterKey: ps.parameterKey,
          },
        },
        create: {
          studentId,
          selectionCycleId,
          weightVersionId: weightVersion.id,
          parameterKey: ps.parameterKey,
          rawScore: ps.rawScore,
          isMissing: ps.isMissing,
          normalizedScore: ps.normalizedScore,
          weight: ps.weight,
          weightedScore: ps.weightedScore,
        },
        update: {
          rawScore: ps.rawScore,
          isMissing: ps.isMissing,
          normalizedScore: ps.normalizedScore,
          weight: ps.weight,
          weightedScore: ps.weightedScore,
        },
      });
    }

    await this.audit.log({
      selectionCycleId,
      action: 'SCORE_CALCULATION_COMPLETED',
      actor: actorId,
      entityType: 'Student',
      entityId: studentId,
      newValue: {
        weightVersionId: weightVersion.id,
        weightVersion: weightVersion.version,
        totalScore: result.totalScore,
        parameterCount: result.parameterScores.length,
        missingCount: result.parameterScores.filter((p) => p.isMissing)
          .length,
      },
    });

    return result;
  }

  async loadActiveWeights(selectionCycleId: string): Promise<{
    weightVersion: { id: string; version: number };
    weightConfigs: ParameterWeightConfig[];
  }> {
    const cycleConfig = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!cycleConfig) {
      throw new NotFoundException(
        'Cycle configuration not found. Create a CycleConfig first.',
      );
    }
    if (!cycleConfig.activeWeightVersionId) {
      throw new BadRequestException(
        'No active weight version configured for this cycle.',
      );
    }

    const weightVersion = await this.prisma.weightVersion.findUnique({
      where: { id: cycleConfig.activeWeightVersionId },
      include: { weights: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!weightVersion) {
      throw new NotFoundException(
        'Active weight version not found in database.',
      );
    }
    if (weightVersion.weights.length === 0) {
      throw new BadRequestException(
        'Active weight version has no parameter weights configured.',
      );
    }

    return {
      weightVersion: {
        id: weightVersion.id,
        version: weightVersion.version,
      },
      weightConfigs: weightVersion.weights.map((pw) => ({
        parameterKey: pw.parameterKey,
        weight: pw.weight,
        maxRawScore: pw.maxRawScore,
      })),
    };
  }

  async getStudentScores(
    studentId: string,
    selectionCycleId: string,
    weightVersionId?: string,
  ): Promise<ScoreCalculationResult | null> {
    let resolvedVersionId = weightVersionId;

    if (!resolvedVersionId) {
      const config = await this.prisma.cycleConfig.findUnique({
        where: { selectionCycleId },
      });
      resolvedVersionId = config?.activeWeightVersionId ?? undefined;
    }

    const where: {
      studentId: string;
      selectionCycleId: string;
      weightVersionId?: string;
    } = { studentId, selectionCycleId };
    if (resolvedVersionId) {
      where.weightVersionId = resolvedVersionId;
    }

    const scores = await this.prisma.studentScore.findMany({
      where,
      orderBy: { parameterKey: 'asc' },
    });

    if (scores.length === 0) return null;

    const versionId = resolvedVersionId ?? scores[0].weightVersionId;
    const versionScores = scores.filter(
      (s) => s.weightVersionId === versionId,
    );

    const parameterScores = versionScores.map((s) => ({
      parameterKey: s.parameterKey,
      rawScore: s.rawScore,
      isMissing: s.isMissing,
      normalizedScore: s.normalizedScore,
      weight: s.weight,
      weightedScore: s.weightedScore,
    }));

    return {
      studentId,
      selectionCycleId,
      weightVersionId: versionId,
      parameterScores,
      totalScore: computeTotalScore(parameterScores),
    };
  }
}
