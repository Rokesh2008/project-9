import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RankingResultContract } from '../../common/contracts/member1.contract';
import {
  calculateRanking,
  DefaultTieBreakStrategy,
  type RankingInput,
  type RankingCalculationResult,
  type TieBreakStrategy,
} from './ranking.engine';

@Injectable()
export class RankingService {
  private tieBreakStrategy: TieBreakStrategy = new DefaultTieBreakStrategy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  setTieBreakStrategy(strategy: TieBreakStrategy): void {
    this.tieBreakStrategy = strategy;
  }

  async resolveWeightVersion(
    selectionCycleId: string,
    weightVersionId?: string,
  ): Promise<{ id: string; version: number }> {
    if (weightVersionId) {
      const wv = await this.prisma.weightVersion.findUnique({
        where: { id: weightVersionId },
      });
      if (!wv) throw new NotFoundException('Weight version not found');
      if (wv.selectionCycleId !== selectionCycleId) {
        throw new BadRequestException(
          'Weight version does not belong to this selection cycle',
        );
      }
      return { id: wv.id, version: wv.version };
    }

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

    const wv = await this.prisma.weightVersion.findUnique({
      where: { id: cycleConfig.activeWeightVersionId },
    });
    if (!wv) {
      throw new NotFoundException(
        'Active weight version not found in database.',
      );
    }
    return { id: wv.id, version: wv.version };
  }

  async loadStudentScores(
    selectionCycleId: string,
    weightVersionId: string,
  ): Promise<RankingInput[]> {
    const [cycleStudents, scores] = await Promise.all([
      this.prisma.studentCycleStatus.findMany({
        where: { selectionCycleId },
        select: { studentId: true },
      }),
      this.prisma.studentScore.findMany({
        where: { selectionCycleId, weightVersionId },
        orderBy: { parameterKey: 'asc' },
      }),
    ]);

    const studentMap = new Map<
      string,
      { totalScore: number; parameterScores: Record<string, number> }
    >();

    for (const cs of cycleStudents) {
      studentMap.set(cs.studentId, { totalScore: 0, parameterScores: {} });
    }

    for (const s of scores) {
      let entry = studentMap.get(s.studentId);
      if (!entry) {
        entry = { totalScore: 0, parameterScores: {} };
        studentMap.set(s.studentId, entry);
      }
      entry.totalScore += s.weightedScore;
      entry.parameterScores[s.parameterKey] = s.weightedScore;
    }

    return Array.from(studentMap.entries()).map(
      ([studentId, data]) => ({
        studentId,
        totalScore: data.totalScore,
        parameterScores: data.parameterScores,
      }),
    );
  }

  async calculate(
    selectionCycleId: string,
    weightVersionId?: string,
    actorId: string = 'system',
  ): Promise<RankingResultContract[]> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const wv = await this.resolveWeightVersion(
      selectionCycleId,
      weightVersionId,
    );

    await this.audit.log({
      selectionCycleId,
      action: 'RANKING_CALCULATION_STARTED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: { weightVersionId: wv.id, weightVersion: wv.version },
    });

    const studentInputs = await this.loadStudentScores(
      selectionCycleId,
      wv.id,
    );

    if (studentInputs.length === 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'RANKING_CALCULATION_COMPLETED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          weightVersionId: wv.id,
          totalStudents: 0,
          tiesResolved: 0,
        },
      });
      return [];
    }

    let result: RankingCalculationResult;
    try {
      result = calculateRanking(
        studentInputs,
        wv.id,
        this.tieBreakStrategy,
      );
    } catch (err) {
      await this.audit.log({
        selectionCycleId,
        action: 'RANKING_CALCULATION_FAILED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          weightVersionId: wv.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    if (result.tiesResolved > 0) {
      await this.audit.log({
        selectionCycleId,
        action: 'RANKING_TIE_RESOLVED',
        actor: actorId,
        entityType: 'SelectionCycle',
        entityId: selectionCycleId,
        metadata: {
          weightVersionId: wv.id,
          tiedStudentCount: result.tiesResolved,
        },
      });
    }

    const upserts = result.rankedStudents.map((rs) =>
      this.prisma.studentRanking.upsert({
        where: {
          studentId_selectionCycleId: {
            studentId: rs.studentId,
            selectionCycleId,
          },
        },
        create: {
          studentId: rs.studentId,
          selectionCycleId,
          weightVersionId: wv.id,
          totalScore: rs.totalScore,
          rank: rs.rank,
          percentile: rs.percentile,
          tieBreakApplied: rs.tieBreakApplied,
        },
        update: {
          weightVersionId: wv.id,
          totalScore: rs.totalScore,
          rank: rs.rank,
          percentile: rs.percentile,
          tieBreakApplied: rs.tieBreakApplied,
          calculatedAt: new Date(),
        },
      }),
    );

    await this.prisma.$transaction(upserts);

    await this.audit.log({
      selectionCycleId,
      action: 'RANKING_CALCULATION_COMPLETED',
      actor: actorId,
      entityType: 'SelectionCycle',
      entityId: selectionCycleId,
      metadata: {
        weightVersionId: wv.id,
        weightVersion: wv.version,
        totalStudents: result.totalStudents,
        tiesResolved: result.tiesResolved,
      },
    });

    return result.rankedStudents.map((rs) => ({
      studentId: rs.studentId,
      selectionCycleId,
      rank: rs.rank,
      percentile: rs.percentile ?? undefined,
      calculatedAt: new Date(),
    }));
  }

  async getLiveRanking(
    selectionCycleId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<{ data: RankingResultContract[]; total: number }> {
    const [rankings, total] = await Promise.all([
      this.prisma.studentRanking.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.studentRanking.count({
        where: { selectionCycleId },
      }),
    ]);

    return {
      data: rankings.map((r) => ({
        studentId: r.studentId,
        selectionCycleId: r.selectionCycleId,
        rank: r.rank,
        percentile: r.percentile ?? undefined,
        calculatedAt: r.calculatedAt,
      })),
      total,
    };
  }

  async getStudentRank(
    studentId: string,
    selectionCycleId: string,
  ): Promise<RankingResultContract | null> {
    const ranking = await this.prisma.studentRanking.findUnique({
      where: {
        studentId_selectionCycleId: { studentId, selectionCycleId },
      },
    });
    if (!ranking) return null;

    return {
      studentId: ranking.studentId,
      selectionCycleId: ranking.selectionCycleId,
      rank: ranking.rank,
      percentile: ranking.percentile ?? undefined,
      calculatedAt: ranking.calculatedAt,
    };
  }
}
