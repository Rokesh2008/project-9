import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SelectionRulesService } from '../../selection-rules/selection-rules.service';
import { Prisma } from '@prisma/client';
import type {
  ClassificationResultContract,
  SelectionAuthorityContract,
} from '../../common/contracts/member1.contract';
import {
  classifyStudents,
  validateClassificationConfig,
  type ClassificationInput,
  type ClassificationCalculationResult,
} from './classification.engine';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly customRules?: SelectionRulesService,
  ) {}

  async loadClassificationInputs(
    selectionCycleId: string,
  ): Promise<ClassificationInput[]> {
    const [rankings, eligibilityResults] = await Promise.all([
      this.prisma.studentRanking.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
      }),
      this.prisma.eligibilityResult.findMany({
        where: { selectionCycleId },
      }),
    ]);

    const eligibilityMap = new Map(
      eligibilityResults.map((er) => [er.studentId, er.isEligible]),
    );

    return Promise.all(rankings.map(async (r) => {
      const isEligible = eligibilityMap.get(r.studentId) ?? false;
      const hope = isEligible && this.customRules ? await this.customRules.evaluate(r.studentId, selectionCycleId, null, 'HOPE') : null;
      const pep = isEligible && this.customRules ? await this.customRules.evaluate(r.studentId, selectionCycleId, null, 'PEP') : null;
      return {
        studentId: r.studentId,
        rank: r.rank,
        hopeEligible: isEligible && (hope?.isEligible ?? true),
        pepEligible: isEligible && (pep?.isEligible ?? true),
        ...(hope||pep ? {customEligibility:{hope,pep}} : {}),
      };
    }));
  }

  async resolveSelectionAuthority(
    selectionCycleId: string,
  ): Promise<SelectionAuthorityContract> {
    const executedSchedule = await this.prisma.freezeSchedule.findFirst({
      where: { selectionCycleId, status: 'EXECUTED' },
      orderBy: { executedAt: 'desc' },
    });

    if (!executedSchedule) {
      return { source: 'LIVE' };
    }

    if (!executedSchedule.snapshotId) {
      throw new ConflictException(
        'Executed freeze has no snapshot. Frozen selection cannot resolve an authoritative snapshot.',
      );
    }

    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { id: executedSchedule.snapshotId },
    });

    if (!snapshot) {
      throw new NotFoundException(
        'Snapshot referenced by executed freeze not found',
      );
    }

    return {
      source: 'SNAPSHOT',
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
    };
  }

  async loadFrozenClassificationInputs(
    snapshotId: string,
  ): Promise<ClassificationInput[]> {
    const entries = await this.prisma.rankingSnapshotEntry.findMany({
      where: { snapshotId },
      orderBy: { rank: 'asc' },
    });

    return entries.map((e) => ({
      studentId: e.studentId,
      rank: e.rank,
      hopeEligible: e.hopeEligible ?? e.isEligible,
      pepEligible: e.pepEligible ?? e.isEligible,
      ...(e.customEligibility ? {customEligibility:e.customEligibility} : {}),
    }));
  }

  async calculateFrozenClassification(
    selectionCycleId: string,
    actorId: string = 'system',
  ): Promise<ClassificationResultContract[]> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const authority = await this.resolveSelectionAuthority(selectionCycleId);
    if (authority.source !== 'SNAPSHOT') {
      throw new ConflictException(
        'No executed freeze found. Frozen classification requires an executed freeze.',
      );
    }

    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { id: authority.snapshotId },
    });
    if (!snapshot) {
      throw new NotFoundException(
        'Snapshot referenced by executed freeze not found',
      );
    }

    const entryCount = await this.prisma.rankingSnapshotEntry.count({
      where: { snapshotId: authority.snapshotId },
    });
    if (entryCount === 0 && snapshot.totalStudents > 0) {
      throw new BadRequestException(
        'Snapshot is incomplete — expected entries are missing',
      );
    }

    const config = {
      hopeCount: snapshot.hopeCount,
      pepCount: snapshot.pepCount,
    };

    const configErrors = validateClassificationConfig(config);
    if (configErrors.length > 0) {
      throw new BadRequestException(configErrors);
    }

    await this.audit.log({
      selectionCycleId,
      action: 'FROZEN_CLASSIFICATION_STARTED',
      actor: actorId,
      entityType: 'RankingSnapshot',
      entityId: authority.snapshotId!,
      metadata: {
        snapshotId: authority.snapshotId,
        snapshotVersion: authority.snapshotVersion,
        hopeCount: config.hopeCount,
        pepCount: config.pepCount,
      },
    });

    const inputs = await this.loadFrozenClassificationInputs(
      authority.snapshotId!,
    );

    if (inputs.length === 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'FROZEN_CLASSIFICATION_COMPLETED',
        actor: actorId,
        entityType: 'RankingSnapshot',
        entityId: authority.snapshotId!,
        metadata: {
          snapshotId: authority.snapshotId,
          snapshotVersion: authority.snapshotVersion,
          totalStudents: 0,
          hopeClassified: 0,
          pepClassified: 0,
          waitlistedCount: 0,
          notEligibleCount: 0,
        },
      });
      return [];
    }

    let result: ClassificationCalculationResult;
    try {
      result = classifyStudents(inputs, config);
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'FROZEN_CLASSIFICATION_FAILED',
        actor: actorId,
        entityType: 'RankingSnapshot',
        entityId: authority.snapshotId!,
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    const upserts = result.classifiedStudents.map((cs) =>
      this.prisma.hopePepClassification.upsert({
        where: {
          studentId_selectionCycleId: {
            studentId: cs.studentId,
            selectionCycleId,
          },
        },
        create: {
          studentId: cs.studentId,
          selectionCycleId,
          snapshotId: authority.snapshotId!,
          program: cs.program,
          customEligibility: cs.customEligibility ? cs.customEligibility as Prisma.InputJsonValue : Prisma.JsonNull,
          rank: cs.rank,
          status: 'CLASSIFIED',
        },
        update: {
          snapshotId: authority.snapshotId!,
          program: cs.program,
          customEligibility: cs.customEligibility ? cs.customEligibility as Prisma.InputJsonValue : Prisma.JsonNull,
          rank: cs.rank,
          status: 'CLASSIFIED',
          classifiedAt: new Date(),
        },
      }),
    );

    await this.prisma.$transaction(upserts);

    await this.audit.log({
      selectionCycleId,
      action: 'FROZEN_CLASSIFICATION_COMPLETED',
      actor: actorId,
      entityType: 'RankingSnapshot',
      entityId: authority.snapshotId!,
      metadata: {
        snapshotId: authority.snapshotId,
        snapshotVersion: authority.snapshotVersion,
        totalStudents: result.totalStudents,
        hopeClassified: result.hopeClassified,
        pepClassified: result.pepClassified,
        waitlistedCount: result.waitlistedCount,
        notEligibleCount: result.notEligibleCount,
        configuredHopeCount: config.hopeCount,
        configuredPepCount: config.pepCount,
      },
    });

    return result.classifiedStudents.map((cs) => ({
      studentId: cs.studentId,
      selectionCycleId,
      program: cs.program,
      rank: cs.rank,
      status: 'CLASSIFIED',
      classifiedAt: new Date(),
      source: 'SNAPSHOT' as const,
      snapshotId: authority.snapshotId,
      snapshotVersion: authority.snapshotVersion,
    }));
  }

  async calculate(
    selectionCycleId: string,
    actorId: string = 'system',
  ): Promise<ClassificationResultContract[]> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const executedFreeze = await this.prisma.freezeSchedule.findFirst({
      where: { selectionCycleId, status: 'EXECUTED' },
    });
    if (executedFreeze) {
      throw new ConflictException(
        'Cannot recalculate live classification after freeze has been executed. Use the frozen classification endpoint.',
      );
    }

    const cycleConfig = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!cycleConfig) {
      throw new NotFoundException(
        'Cycle configuration not found. Create a CycleConfig first.',
      );
    }

    const config = {
      hopeCount: cycleConfig.hopeCount,
      pepCount: cycleConfig.pepCount,
    };

    const configErrors = validateClassificationConfig(config);
    if (configErrors.length > 0) {
      throw new BadRequestException(configErrors);
    }

    await this.audit.log({
      selectionCycleId,
      action: 'CLASSIFICATION_CALCULATION_STARTED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        hopeCount: config.hopeCount,
        pepCount: config.pepCount,
      },
    });

    const inputs = await this.loadClassificationInputs(selectionCycleId);

    if (inputs.length === 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'CLASSIFICATION_CALCULATION_COMPLETED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          totalStudents: 0,
          hopeClassified: 0,
          pepClassified: 0,
          waitlistedCount: 0,
          notEligibleCount: 0,
        },
      });
      return [];
    }

    let result: ClassificationCalculationResult;
    try {
      result = classifyStudents(inputs, config);
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'CLASSIFICATION_CALCULATION_FAILED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    const upserts = result.classifiedStudents.map((cs) =>
      this.prisma.hopePepClassification.upsert({
        where: {
          studentId_selectionCycleId: {
            studentId: cs.studentId,
            selectionCycleId,
          },
        },
        create: {
          studentId: cs.studentId,
          selectionCycleId,
          program: cs.program,
          customEligibility: cs.customEligibility ? cs.customEligibility as Prisma.InputJsonValue : Prisma.JsonNull,
          rank: cs.rank,
          status: 'CLASSIFIED',
        },
        update: {
          program: cs.program,
          customEligibility: cs.customEligibility ? cs.customEligibility as Prisma.InputJsonValue : Prisma.JsonNull,
          rank: cs.rank,
          status: 'CLASSIFIED',
          classifiedAt: new Date(),
        },
      }),
    );

    await this.prisma.$transaction(upserts);

    await this.audit.log({
      selectionCycleId,
      action: 'CLASSIFICATION_CALCULATION_COMPLETED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        totalStudents: result.totalStudents,
        hopeClassified: result.hopeClassified,
        pepClassified: result.pepClassified,
        waitlistedCount: result.waitlistedCount,
        notEligibleCount: result.notEligibleCount,
        configuredHopeCount: config.hopeCount,
        configuredPepCount: config.pepCount,
      },
    });

    return result.classifiedStudents.map((cs) => ({
      studentId: cs.studentId,
      selectionCycleId,
      program: cs.program,
      rank: cs.rank,
      status: 'CLASSIFIED',
      classifiedAt: new Date(),
      source: 'LIVE' as const,
    }));
  }

  async getClassifications(
    selectionCycleId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{ data: ClassificationResultContract[]; total: number }> {
    const [classifications, total] = await Promise.all([
      this.prisma.hopePepClassification.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.hopePepClassification.count({
        where: { selectionCycleId },
      }),
    ]);

    return {
      data: classifications.map((c) => ({
        studentId: c.studentId,
        selectionCycleId: c.selectionCycleId,
        program: c.program,
        rank: c.rank,
        status: c.status,
        classifiedAt: c.classifiedAt,
        source: (c.snapshotId ? 'SNAPSHOT' : 'LIVE') as 'LIVE' | 'SNAPSHOT',
        snapshotId: c.snapshotId ?? undefined,
      })),
      total,
    };
  }

  async getStudentClassification(
    studentId: string,
    selectionCycleId: string,
  ): Promise<ClassificationResultContract | null> {
    const classification =
      await this.prisma.hopePepClassification.findUnique({
        where: {
          studentId_selectionCycleId: { studentId, selectionCycleId },
        },
      });
    if (!classification) return null;

    return {
      studentId: classification.studentId,
      selectionCycleId: classification.selectionCycleId,
      program: classification.program,
      rank: classification.rank,
      status: classification.status,
      classifiedAt: classification.classifiedAt,
      source: (classification.snapshotId ? 'SNAPSHOT' : 'LIVE') as
        | 'LIVE'
        | 'SNAPSHOT',
      snapshotId: classification.snapshotId ?? undefined,
    };
  }
}
