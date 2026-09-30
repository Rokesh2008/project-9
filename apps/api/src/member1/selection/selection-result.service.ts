import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ClassificationService } from '../classification/classification.service';
import type {
  SelectionResultContract,
  SelectionAuthorityContract,
} from '../../common/contracts/member1.contract';

@Injectable()
export class SelectionResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
  ) {}

  buildDecisionReference(
    selectionCycleId: string,
    studentId: string,
    authority: SelectionAuthorityContract,
  ): string {
    if (authority.source === 'SNAPSHOT') {
      return `SEL:${selectionCycleId}:${studentId}:SNAP:${authority.snapshotId}:v${authority.snapshotVersion}`;
    }
    return `SEL:${selectionCycleId}:${studentId}:LIVE`;
  }

  async getSelectionResults(
    selectionCycleId: string,
  ): Promise<SelectionResultContract[]> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const authority =
      await this.classification.resolveSelectionAuthority(selectionCycleId);

    if (authority.source === 'SNAPSHOT') {
      return this.buildFrozenResults(selectionCycleId, authority);
    }

    return this.buildLiveResults(selectionCycleId, authority);
  }

  async getStudentSelectionResult(
    selectionCycleId: string,
    studentId: string,
  ): Promise<SelectionResultContract | null> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const authority =
      await this.classification.resolveSelectionAuthority(selectionCycleId);

    if (authority.source === 'SNAPSHOT') {
      return this.buildFrozenStudentResult(
        selectionCycleId,
        studentId,
        authority,
      );
    }

    return this.buildLiveStudentResult(
      selectionCycleId,
      studentId,
      authority,
    );
  }

  private async buildLiveResults(
    selectionCycleId: string,
    authority: SelectionAuthorityContract,
  ): Promise<SelectionResultContract[]> {
    const [classifications, rankings] = await Promise.all([
      this.prisma.hopePepClassification.findMany({
        where: { selectionCycleId },
        orderBy: { rank: 'asc' },
      }),
      this.prisma.studentRanking.findMany({
        where: { selectionCycleId },
      }),
    ]);

    if (classifications.length === 0) {
      throw new NotFoundException(
        'No classification data found for this cycle. Run classification first.',
      );
    }

    const scoreMap = new Map(
      rankings.map((r) => [r.studentId, r.totalScore]),
    );

    const now = new Date();

    return classifications.map((c) => ({
      studentId: c.studentId,
      selectionCycleId,
      selected: c.program !== 'NOT_ELIGIBLE',
      programCode: c.program,
      rank: c.rank,
      score: scoreMap.get(c.studentId),
      decisionReference: this.buildDecisionReference(
        selectionCycleId,
        c.studentId,
        authority,
      ),
      evaluatedAt: c.classifiedAt ?? now,
      source: 'LIVE' as const,
    }));
  }

  private async buildLiveStudentResult(
    selectionCycleId: string,
    studentId: string,
    authority: SelectionAuthorityContract,
  ): Promise<SelectionResultContract | null> {
    const classification =
      await this.prisma.hopePepClassification.findUnique({
        where: {
          studentId_selectionCycleId: { studentId, selectionCycleId },
        },
      });

    if (!classification) return null;

    const ranking = await this.prisma.studentRanking.findUnique({
      where: {
        studentId_selectionCycleId: { studentId, selectionCycleId },
      },
    });

    return {
      studentId: classification.studentId,
      selectionCycleId,
      selected: classification.program !== 'NOT_ELIGIBLE',
      programCode: classification.program,
      rank: classification.rank,
      score: ranking?.totalScore,
      decisionReference: this.buildDecisionReference(
        selectionCycleId,
        studentId,
        authority,
      ),
      evaluatedAt: classification.classifiedAt,
      source: 'LIVE' as const,
    };
  }

  private async buildFrozenResults(
    selectionCycleId: string,
    authority: SelectionAuthorityContract,
  ): Promise<SelectionResultContract[]> {
    const [snapshot, entries] = await Promise.all([
      this.prisma.rankingSnapshot.findFirst({
        where: { id: authority.snapshotId },
      }),
      this.prisma.rankingSnapshotEntry.findMany({
        where: { snapshotId: authority.snapshotId },
        orderBy: { rank: 'asc' },
      }),
    ]);

    if (entries.length === 0) {
      if (snapshot && snapshot.totalStudents > 0) {
        throw new BadRequestException(
          'Snapshot is incomplete — expected entries are missing',
        );
      }
      return [];
    }

    const evaluatedAt = snapshot?.frozenAt ?? new Date();

    return entries.map((e) => {
      const program = e.program ?? 'UNCLASSIFIED';
      return {
        studentId: e.studentId,
        selectionCycleId,
        selected: program !== 'NOT_ELIGIBLE' && program !== 'UNCLASSIFIED',
        programCode: program,
        rank: e.rank,
        score: e.totalScore,
        decisionReference: this.buildDecisionReference(
          selectionCycleId,
          e.studentId,
          authority,
        ),
        evaluatedAt,
        source: 'SNAPSHOT' as const,
        snapshotId: authority.snapshotId,
        snapshotVersion: authority.snapshotVersion,
      };
    });
  }

  private async buildFrozenStudentResult(
    selectionCycleId: string,
    studentId: string,
    authority: SelectionAuthorityContract,
  ): Promise<SelectionResultContract | null> {
    const [snapshot, entry] = await Promise.all([
      this.prisma.rankingSnapshot.findFirst({
        where: { id: authority.snapshotId },
      }),
      this.prisma.rankingSnapshotEntry.findFirst({
        where: { snapshotId: authority.snapshotId, studentId },
      }),
    ]);

    if (!entry) return null;

    const program = entry.program ?? 'UNCLASSIFIED';
    const evaluatedAt = snapshot?.frozenAt ?? new Date();

    return {
      studentId: entry.studentId,
      selectionCycleId,
      selected: program !== 'NOT_ELIGIBLE' && program !== 'UNCLASSIFIED',
      programCode: program,
      rank: entry.rank,
      score: entry.totalScore,
      decisionReference: this.buildDecisionReference(
        selectionCycleId,
        studentId,
        authority,
      ),
      evaluatedAt,
      source: 'SNAPSHOT' as const,
      snapshotId: authority.snapshotId,
      snapshotVersion: authority.snapshotVersion,
    };
  }
}
