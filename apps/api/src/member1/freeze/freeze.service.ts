import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  assembleSnapshot,
  isFreezeDue,
  validateSnapshotInputs,
  type SnapshotStudentInput,
  type ParameterScoreDetail,
} from './freeze.engine';
import { FreezeNotificationService } from './freeze-notification.service';
import {
  classifyStudents,
  validateClassificationConfig,
} from '../classification/classification.engine';

export interface ProcessDueFreezesResult {
  checkedAt: Date;
  dueCount: number;
  executedCount: number;
  failedCount: number;
  results: Array<{
    selectionCycleId: string;
    scheduleId: string;
    success: boolean;
    snapshotId?: string;
    version?: number;
    error?: string;
  }>;
}

@Injectable()
export class FreezeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: FreezeNotificationService,
  ) {}

  async schedule(
    selectionCycleId: string,
    scheduledAt: Date,
    actorId: string,
  ): Promise<{ id: string; scheduledAt: Date; status: string }> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Scheduled time must be in the future',
      );
    }

    const existingActive = await this.prisma.freezeSchedule.findFirst({
      where: {
        selectionCycleId,
        status: 'SCHEDULED',
      },
    });
    if (existingActive) {
      throw new ConflictException(
        'An active freeze schedule already exists for this cycle',
      );
    }

    const schedule = await this.prisma.freezeSchedule.create({
      data: {
        selectionCycleId,
        scheduledAt,
        status: 'SCHEDULED',
        scheduledBy: actorId,
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_SCHEDULE_CREATED',
      actor: actorId,
      entityType: 'FreezeSchedule',
      entityId: schedule.id,
      metadata: {
        scheduledAt: scheduledAt.toISOString(),
      },
    });

    await this.notifications.planAndPersist(
      selectionCycleId,
      schedule.id,
      scheduledAt,
      schedule.createdAt,
    );

    return {
      id: schedule.id,
      scheduledAt: schedule.scheduledAt,
      status: schedule.status,
    };
  }

  async cancel(
    selectionCycleId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const schedule = await this.prisma.freezeSchedule.findFirst({
      where: {
        selectionCycleId,
        status: 'SCHEDULED',
      },
    });
    if (!schedule) {
      const executed = await this.prisma.freezeSchedule.findFirst({
        where: { selectionCycleId, status: 'EXECUTED' },
      });
      if (executed) {
        throw new ConflictException(
          'Freeze has already been executed for this cycle and cannot be cancelled',
        );
      }
      const cancelled = await this.prisma.freezeSchedule.findFirst({
        where: { selectionCycleId, status: 'CANCELLED' },
        orderBy: { updatedAt: 'desc' },
      });
      if (cancelled) {
        throw new ConflictException(
          'Freeze schedule has already been cancelled',
        );
      }
      throw new NotFoundException(
        'No active freeze schedule found for this cycle',
      );
    }

    await this.prisma.freezeSchedule.update({
      where: { id: schedule.id },
      data: {
        status: 'CANCELLED',
        cancelledBy: actorId,
        cancelReason: reason,
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_CANCELLED',
      actor: actorId,
      entityType: 'FreezeSchedule',
      entityId: schedule.id,
      metadata: {
        reason,
        originalScheduledAt: schedule.scheduledAt.toISOString(),
      },
    });

    await this.notifications.cancelEventsForSchedule(
      selectionCycleId,
      schedule.id,
    );
  }

  async postpone(
    selectionCycleId: string,
    newScheduledAt: Date,
    actorId: string,
    reason?: string,
  ): Promise<{ id: string; scheduledAt: Date; status: string }> {
    if (newScheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'New scheduled time must be in the future',
      );
    }

    const schedule = await this.prisma.freezeSchedule.findFirst({
      where: {
        selectionCycleId,
        status: 'SCHEDULED',
      },
    });
    if (!schedule) {
      const cancelled = await this.prisma.freezeSchedule.findFirst({
        where: { selectionCycleId, status: 'CANCELLED' },
      });
      if (cancelled) {
        throw new ConflictException(
          'Cannot postpone a cancelled freeze schedule',
        );
      }
      throw new NotFoundException(
        'No active freeze schedule found for this cycle',
      );
    }

    const oldScheduledAt = schedule.scheduledAt;

    await this.prisma.freezeSchedule.update({
      where: { id: schedule.id },
      data: { status: 'POSTPONED' },
    });

    const newSchedule = await this.prisma.freezeSchedule.create({
      data: {
        selectionCycleId,
        scheduledAt: newScheduledAt,
        status: 'SCHEDULED',
        scheduledBy: actorId,
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_POSTPONED',
      actor: actorId,
      entityType: 'FreezeSchedule',
      entityId: newSchedule.id,
      metadata: {
        previousScheduleId: schedule.id,
        previousScheduledAt: oldScheduledAt.toISOString(),
        newScheduledAt: newScheduledAt.toISOString(),
        reason: reason ?? null,
      },
    });

    await this.notifications.cancelEventsForSchedule(
      selectionCycleId,
      schedule.id,
    );
    await this.notifications.planAndPersist(
      selectionCycleId,
      newSchedule.id,
      newScheduledAt,
      newSchedule.createdAt,
    );

    return {
      id: newSchedule.id,
      scheduledAt: newSchedule.scheduledAt,
      status: newSchedule.status,
    };
  }

  async executeFreeze(
    selectionCycleId: string,
    actorId: string,
    reason?: string,
  ): Promise<{ snapshotId: string; version: number; studentCount: number }> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const activeSchedule = await this.prisma.freezeSchedule.findFirst({
      where: { selectionCycleId, status: 'SCHEDULED' },
    });
    if (!activeSchedule) {
      const executedSchedule = await this.prisma.freezeSchedule.findFirst({
        where: { selectionCycleId, status: 'EXECUTED' },
      });
      if (executedSchedule) {
        throw new ConflictException(
          'Freeze has already been executed for this cycle',
        );
      }
    }

    await this.audit.log({
      selectionCycleId,
      action: 'FREEZE_EXECUTION_STARTED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
    });

    try {
      const cycleConfig = await this.prisma.cycleConfig.findUnique({
        where: { selectionCycleId },
      });
      if (!cycleConfig || !cycleConfig.activeWeightVersionId) {
        throw new BadRequestException(
          'No active weight version configured for this cycle',
        );
      }

      const weightVersion = await this.prisma.weightVersion.findUnique({
        where: { id: cycleConfig.activeWeightVersionId },
        include: { weights: true },
      });
      if (!weightVersion) {
        throw new NotFoundException('Active weight version not found');
      }

      const ruleVersionId = cycleConfig.eligibilityRuleVersionId ?? null;
      let ruleVersion: { id: string; version: number } | null = null;
      if (ruleVersionId) {
        ruleVersion = await this.prisma.eligibilityRuleVersion.findUnique({
          where: { id: ruleVersionId },
          select: { id: true, version: true },
        });
      }

      const rankings = await this.prisma.studentRanking.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
      });

      if (rankings.length === 0) {
        const cycleStudentCount = await this.prisma.studentCycleStatus.count({
          where: { selectionCycleId },
        });
        if (cycleStudentCount > 0) {
          throw new BadRequestException(
            'Selection cycle has students but no ranking data exists. Run ranking calculation before freezing.',
          );
        }
      }

      const studentIds = rankings.map((r) => r.studentId);

      const scores = await this.prisma.studentScore.findMany({
        where: {
          selectionCycleId,
          weightVersionId: weightVersion.id,
          studentId: { in: studentIds },
        },
      });

      const scoresByStudent = new Map<string, typeof scores>();
      for (const s of scores) {
        const existing = scoresByStudent.get(s.studentId) ?? [];
        existing.push(s);
        scoresByStudent.set(s.studentId, existing);
      }

      const eligibilityResults = await this.prisma.eligibilityResult.findMany({
        where: { selectionCycleId, studentId: { in: studentIds } },
      });
      const eligibilityMap = new Map(
        eligibilityResults.map((er) => [
          er.studentId,
          {
            isEligible: er.isEligible,
            failedRules: er.failedRules as unknown as Array<{
              message: string;
            }> | null,
          },
        ]),
      );

      const classifications =
        await this.prisma.hopePepClassification.findMany({
          where: { selectionCycleId, studentId: { in: studentIds } },
        });
      const classificationMap = new Map(
        classifications.map((c) => [c.studentId, c]),
      );

      const snapshotEntries: SnapshotStudentInput[] = rankings.map((r) => {
        const studentScores = scoresByStudent.get(r.studentId) ?? [];
        const parameterScores: Record<string, ParameterScoreDetail> = {};
        for (const s of studentScores) {
          parameterScores[s.parameterKey] = {
            raw: s.rawScore,
            normalized: s.normalizedScore,
            weight: s.weight,
            weighted: s.weightedScore,
            isMissing: s.isMissing,
          };
        }

        const eligibility = eligibilityMap.get(r.studentId);
        const classification = classificationMap.get(r.studentId);

        return {
          studentId: r.studentId,
          rank: r.rank,
          totalScore: r.totalScore,
          percentile: r.percentile,
          parameterScores,
          isEligible: eligibility?.isEligible ?? false,
          eligibilityFailures:
            eligibility?.failedRules?.map((fr) => fr.message) ?? null,
          program: classification?.program ?? null,
          tieBreakApplied: r.tieBreakApplied,
        };
      });

      const validationErrors = validateSnapshotInputs(snapshotEntries);
      if (validationErrors.length > 0) {
        throw new BadRequestException(
          `Snapshot validation failed: ${validationErrors.join('; ')}`,
        );
      }

      const hopeCount = snapshotEntries.filter(
        (e) => e.program === 'HOPE',
      ).length;
      const pepCount = snapshotEntries.filter(
        (e) => e.program === 'PEP',
      ).length;

      const latestSnapshot = await this.prisma.rankingSnapshot.findFirst({
        where: { selectionCycleId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latestSnapshot?.version ?? 0) + 1;

      const assembled = assembleSnapshot(snapshotEntries, {
        selectionCycleId,
        version: nextVersion,
        weightVersionId: weightVersion.id,
        ruleVersionId: ruleVersion?.id ?? null,
        hopeCount,
        pepCount,
        frozenBy: actorId,
        reason,
      });

      const result = await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.rankingSnapshot.create({
          data: {
            selectionCycleId,
            version: nextVersion,
            weightVersionId: weightVersion.id,
            ruleVersionId: ruleVersion?.id ?? null,
            hopeCount,
            pepCount,
            totalStudents: assembled.totalStudents,
            frozenBy: actorId,
            reason: reason ?? null,
          },
        });

        if (assembled.entries.length > 0) {
          await tx.rankingSnapshotEntry.createMany({
            data: assembled.entries.map((e) => ({
              snapshotId: snapshot.id,
              studentId: e.studentId,
              rank: e.rank,
              totalScore: e.totalScore,
              percentile: e.percentile,
              parameterScores:
                e.parameterScores as unknown as Prisma.InputJsonValue,
              isEligible: e.isEligible,
              eligibilityFailures: e.eligibilityFailures
                ? (e.eligibilityFailures as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              program: e.program,
              tieBreakApplied: e.tieBreakApplied,
            })),
          });
        }

        const activeSchedule = await tx.freezeSchedule.findFirst({
          where: { selectionCycleId, status: 'SCHEDULED' },
        });
        if (activeSchedule) {
          await tx.freezeSchedule.update({
            where: { id: activeSchedule.id },
            data: {
              status: 'EXECUTED',
              executedAt: new Date(),
              snapshotId: snapshot.id,
            },
          });
        }

        return snapshot;
      });

      await this.audit.log({
        selectionCycleId,
        action: 'SNAPSHOT_CREATED',
        actor: actorId,
        entityType: 'RankingSnapshot',
        entityId: result.id,
        metadata: {
          snapshotVersion: nextVersion,
          studentCount: assembled.totalStudents,
          hopeCount,
          pepCount,
          weightVersionId: weightVersion.id,
          weightVersion: weightVersion.version,
          ruleVersionId: ruleVersion?.id ?? null,
        },
      });

      await this.audit.log({
        selectionCycleId,
        action: 'FREEZE_EXECUTION_COMPLETED',
        actor: actorId,
        entityType: 'RankingSnapshot',
        entityId: result.id,
        metadata: {
          snapshotId: result.id,
          snapshotVersion: nextVersion,
          studentCount: assembled.totalStudents,
          frozenAt: result.frozenAt.toISOString(),
        },
      });

      if (activeSchedule) {
        await this.notifications.markExecuted(
          selectionCycleId,
          activeSchedule.id,
        );
      }

      return {
        snapshotId: result.id,
        version: nextVersion,
        studentCount: assembled.totalStudents,
      };
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'FREEZE_EXECUTION_FAILED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  async refreeze(
    selectionCycleId: string,
    actorId: string,
    reason?: string,
  ): Promise<{
    snapshotId: string;
    version: number;
    previousSnapshotId: string;
    previousVersion: number;
    studentCount: number;
    hopeCount: number;
    pepCount: number;
  }> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const executedSchedule = await this.prisma.freezeSchedule.findFirst({
      where: { selectionCycleId, status: 'EXECUTED' },
      orderBy: { executedAt: 'desc' },
    });
    if (!executedSchedule) {
      throw new ConflictException(
        'No executed freeze found. Re-freeze requires an existing executed freeze.',
      );
    }
    if (!executedSchedule.snapshotId) {
      throw new ConflictException(
        'Executed freeze has no snapshot. Cannot perform re-freeze.',
      );
    }

    const currentSnapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { id: executedSchedule.snapshotId },
    });
    if (!currentSnapshot) {
      throw new NotFoundException('Current authoritative snapshot not found');
    }

    await this.audit.log({
      selectionCycleId,
      action: 'REFREEZE_STARTED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        previousSnapshotId: currentSnapshot.id,
        previousVersion: currentSnapshot.version,
      },
    });

    try {
      const cycleConfig = await this.prisma.cycleConfig.findUnique({
        where: { selectionCycleId },
      });
      if (!cycleConfig || !cycleConfig.activeWeightVersionId) {
        throw new BadRequestException(
          'No active weight version configured for this cycle',
        );
      }

      const weightVersion = await this.prisma.weightVersion.findUnique({
        where: { id: cycleConfig.activeWeightVersionId },
        include: { weights: true },
      });
      if (!weightVersion) {
        throw new NotFoundException('Active weight version not found');
      }

      const ruleVersionId = cycleConfig.eligibilityRuleVersionId ?? null;
      let ruleVersion: { id: string; version: number } | null = null;
      if (ruleVersionId) {
        ruleVersion = await this.prisma.eligibilityRuleVersion.findUnique({
          where: { id: ruleVersionId },
          select: { id: true, version: true },
        });
      }

      const rankings = await this.prisma.studentRanking.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
      });

      const studentIds = rankings.map((r) => r.studentId);

      const scores = await this.prisma.studentScore.findMany({
        where: {
          selectionCycleId,
          weightVersionId: weightVersion.id,
          studentId: { in: studentIds },
        },
      });

      const scoresByStudent = new Map<string, typeof scores>();
      for (const s of scores) {
        const existing = scoresByStudent.get(s.studentId) ?? [];
        existing.push(s);
        scoresByStudent.set(s.studentId, existing);
      }

      const eligibilityResults = await this.prisma.eligibilityResult.findMany({
        where: { selectionCycleId, studentId: { in: studentIds } },
      });
      const eligibilityMap = new Map(
        eligibilityResults.map((er) => [
          er.studentId,
          {
            isEligible: er.isEligible,
            failedRules: er.failedRules as unknown as Array<{
              message: string;
            }> | null,
          },
        ]),
      );

      if (rankings.length === 0) {
        const cycleStudentCount = await this.prisma.studentCycleStatus.count({
          where: { selectionCycleId },
        });
        if (cycleStudentCount > 0) {
          throw new BadRequestException(
            'Selection cycle has students but no ranking data exists. Run ranking calculation before re-freeze.',
          );
        }
      }

      const classificationInputs = rankings.map((r) => ({
        studentId: r.studentId,
        rank: r.rank,
        hopeEligible: eligibilityMap.get(r.studentId)?.isEligible ?? false,
        pepEligible: eligibilityMap.get(r.studentId)?.isEligible ?? false,
      }));

      const config = {
        hopeCount: cycleConfig.hopeCount,
        pepCount: cycleConfig.pepCount,
      };

      const configErrors = validateClassificationConfig(config);
      if (configErrors.length > 0) {
        throw new BadRequestException(configErrors);
      }

      const classificationResult = classifyStudents(classificationInputs, config);
      const programByStudent = new Map(
        classificationResult.classifiedStudents.map((cs) => [cs.studentId, cs.program]),
      );

      const snapshotEntries: SnapshotStudentInput[] = rankings.map((r) => {
        const studentScores = scoresByStudent.get(r.studentId) ?? [];
        const parameterScores: Record<string, ParameterScoreDetail> = {};
        for (const s of studentScores) {
          parameterScores[s.parameterKey] = {
            raw: s.rawScore,
            normalized: s.normalizedScore,
            weight: s.weight,
            weighted: s.weightedScore,
            isMissing: s.isMissing,
          };
        }
        const eligibility = eligibilityMap.get(r.studentId);
        return {
          studentId: r.studentId,
          rank: r.rank,
          totalScore: r.totalScore,
          percentile: r.percentile,
          parameterScores,
          isEligible: eligibility?.isEligible ?? false,
          eligibilityFailures:
            eligibility?.failedRules?.map((fr) => fr.message) ?? null,
          program: programByStudent.get(r.studentId) ?? null,
          tieBreakApplied: r.tieBreakApplied,
        };
      });

      const validationErrors = validateSnapshotInputs(snapshotEntries);
      if (validationErrors.length > 0) {
        throw new BadRequestException(
          `Snapshot validation failed: ${validationErrors.join('; ')}`,
        );
      }

      const hopeCount = classificationResult.hopeClassified;
      const pepCount = classificationResult.pepClassified;

      const latestSnapshot = await this.prisma.rankingSnapshot.findFirst({
        where: { selectionCycleId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latestSnapshot?.version ?? 0) + 1;

      const result = await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.rankingSnapshot.create({
          data: {
            selectionCycleId,
            version: nextVersion,
            weightVersionId: weightVersion.id,
            ruleVersionId: ruleVersion?.id ?? null,
            hopeCount,
            pepCount,
            totalStudents: snapshotEntries.length,
            frozenBy: actorId,
            reason: reason ?? null,
          },
        });

        if (snapshotEntries.length > 0) {
          await tx.rankingSnapshotEntry.createMany({
            data: snapshotEntries.map((e) => ({
              snapshotId: snapshot.id,
              studentId: e.studentId,
              rank: e.rank,
              totalScore: e.totalScore,
              percentile: e.percentile,
              parameterScores:
                e.parameterScores as unknown as Prisma.InputJsonValue,
              isEligible: e.isEligible,
              eligibilityFailures: e.eligibilityFailures
                ? (e.eligibilityFailures as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
              program: e.program,
              tieBreakApplied: e.tieBreakApplied,
            })),
          });
        }

        // New EXECUTED schedule — resolveSelectionAuthority orders by executedAt desc
        await tx.freezeSchedule.create({
          data: {
            selectionCycleId,
            scheduledAt: snapshot.frozenAt,
            status: 'EXECUTED',
            executedAt: snapshot.frozenAt,
            snapshotId: snapshot.id,
            scheduledBy: actorId,
          },
        });

        for (const cs of classificationResult.classifiedStudents) {
          await tx.hopePepClassification.upsert({
            where: {
              studentId_selectionCycleId: {
                studentId: cs.studentId,
                selectionCycleId,
              },
            },
            create: {
              studentId: cs.studentId,
              selectionCycleId,
              snapshotId: snapshot.id,
              program: cs.program,
              rank: cs.rank,
              status: 'CLASSIFIED',
            },
            update: {
              snapshotId: snapshot.id,
              program: cs.program,
              rank: cs.rank,
              status: 'CLASSIFIED',
              classifiedAt: new Date(),
            },
          });
        }

        return snapshot;
      });

      await this.audit.log({
        selectionCycleId,
        action: 'REFREEZE_COMPLETED',
        actor: actorId,
        entityType: 'RankingSnapshot',
        entityId: result.id,
        metadata: {
          newSnapshotId: result.id,
          newVersion: nextVersion,
          previousSnapshotId: currentSnapshot.id,
          previousVersion: currentSnapshot.version,
          studentCount: snapshotEntries.length,
          hopeCount,
          pepCount,
          frozenAt: result.frozenAt.toISOString(),
        },
      });

      return {
        snapshotId: result.id,
        version: nextVersion,
        previousSnapshotId: currentSnapshot.id,
        previousVersion: currentSnapshot.version,
        studentCount: snapshotEntries.length,
        hopeCount,
        pepCount,
      };
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'REFREEZE_FAILED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          previousSnapshotId: currentSnapshot.id,
          previousVersion: currentSnapshot.version,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  async getSchedule(
    selectionCycleId: string,
  ): Promise<
    Array<{
      id: string;
      scheduledAt: Date;
      status: string;
      executedAt: Date | null;
      snapshotId: string | null;
      scheduledBy: string;
      cancelledBy: string | null;
      cancelReason: string | null;
      createdAt: Date;
    }>
  > {
    const schedules = await this.prisma.freezeSchedule.findMany({
      where: { selectionCycleId },
      orderBy: { createdAt: 'desc' },
    });

    return schedules.map((s) => ({
      id: s.id,
      scheduledAt: s.scheduledAt,
      status: s.status,
      executedAt: s.executedAt,
      snapshotId: s.snapshotId,
      scheduledBy: s.scheduledBy,
      cancelledBy: s.cancelledBy,
      cancelReason: s.cancelReason,
      createdAt: s.createdAt,
    }));
  }

  async getSnapshots(
    selectionCycleId: string,
  ): Promise<
    Array<{
      id: string;
      version: number;
      totalStudents: number;
      hopeCount: number;
      pepCount: number;
      frozenAt: Date;
      frozenBy: string;
      weightVersionId: string;
      ruleVersionId: string | null;
    }>
  > {
    const snapshots = await this.prisma.rankingSnapshot.findMany({
      where: { selectionCycleId },
      orderBy: { version: 'desc' },
    });

    return snapshots.map((s) => ({
      id: s.id,
      version: s.version,
      totalStudents: s.totalStudents,
      hopeCount: s.hopeCount,
      pepCount: s.pepCount,
      frozenAt: s.frozenAt,
      frozenBy: s.frozenBy,
      weightVersionId: s.weightVersionId,
      ruleVersionId: s.ruleVersionId,
    }));
  }

  async getLatestSnapshot(selectionCycleId: string) {
    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { selectionCycleId },
      orderBy: { version: 'desc' },
    });
    if (!snapshot) {
      throw new NotFoundException(
        'No snapshots found for this selection cycle',
      );
    }

    return {
      id: snapshot.id,
      version: snapshot.version,
      selectionCycleId: snapshot.selectionCycleId,
      totalStudents: snapshot.totalStudents,
      hopeCount: snapshot.hopeCount,
      pepCount: snapshot.pepCount,
      frozenAt: snapshot.frozenAt,
      frozenBy: snapshot.frozenBy,
      weightVersionId: snapshot.weightVersionId,
      ruleVersionId: snapshot.ruleVersionId,
      reason: snapshot.reason,
    };
  }

  async getSnapshot(selectionCycleId: string, snapshotId: string) {
    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { id: snapshotId, selectionCycleId },
    });
    if (!snapshot) {
      throw new NotFoundException('Snapshot not found');
    }

    return {
      id: snapshot.id,
      version: snapshot.version,
      selectionCycleId: snapshot.selectionCycleId,
      totalStudents: snapshot.totalStudents,
      hopeCount: snapshot.hopeCount,
      pepCount: snapshot.pepCount,
      frozenAt: snapshot.frozenAt,
      frozenBy: snapshot.frozenBy,
      weightVersionId: snapshot.weightVersionId,
      ruleVersionId: snapshot.ruleVersionId,
      reason: snapshot.reason,
    };
  }

  async getSnapshotStudents(
    selectionCycleId: string,
    snapshotId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{
    data: Array<{
      id: string;
      studentId: string;
      rank: number;
      totalScore: number;
      percentile: number | null;
      parameterScores: unknown;
      isEligible: boolean;
      eligibilityFailures: unknown;
      program: string | null;
      tieBreakApplied: boolean;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { id: snapshotId, selectionCycleId },
    });
    if (!snapshot) {
      throw new NotFoundException('Snapshot not found');
    }

    const [entries, total] = await Promise.all([
      this.prisma.rankingSnapshotEntry.findMany({
        where: { snapshotId },
        orderBy: { rank: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.rankingSnapshotEntry.count({
        where: { snapshotId },
      }),
    ]);

    return {
      data: entries.map((e) => ({
        id: e.id,
        studentId: e.studentId,
        rank: e.rank,
        totalScore: e.totalScore,
        percentile: e.percentile,
        parameterScores: e.parameterScores,
        isEligible: e.isEligible,
        eligibilityFailures: e.eligibilityFailures,
        program: e.program,
        tieBreakApplied: e.tieBreakApplied,
      })),
      total,
      page,
      pageSize,
    };
  }

  async processDueFreezes(
    currentTime: Date = new Date(),
  ): Promise<ProcessDueFreezesResult> {
    const scheduledFreezes = await this.prisma.freezeSchedule.findMany({
      where: { status: 'SCHEDULED' },
    });

    const dueFreezes = scheduledFreezes.filter((f) =>
      isFreezeDue(f.status, f.scheduledAt, currentTime),
    );

    const results: ProcessDueFreezesResult['results'] = [];
    let executedCount = 0;
    let failedCount = 0;

    for (const freeze of dueFreezes) {
      try {
        const result = await this.executeFreeze(
          freeze.selectionCycleId,
          'SYSTEM_SCHEDULER',
        );
        results.push({
          selectionCycleId: freeze.selectionCycleId,
          scheduleId: freeze.id,
          success: true,
          snapshotId: result.snapshotId,
          version: result.version,
        });
        executedCount++;
      } catch (err) {
        results.push({
          selectionCycleId: freeze.selectionCycleId,
          scheduleId: freeze.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failedCount++;
      }
    }

    // Note: No system-level audit.log here — ScoreAuditLog requires a valid
    // SelectionCycle FK so there is no safe cycle ID for a cross-cycle batch
    // operation. Each individual freeze already emits its own audit events
    // via executeFreeze(). The structured result below captures all
    // batch-level information for callers.

    return {
      checkedAt: currentTime,
      dueCount: dueFreezes.length,
      executedCount,
      failedCount,
      results,
    };
  }
}
