import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async run() {
    const eligible = await this.prisma.student.findMany({
      where: {
        OR: [
          { eligibilityResults: { some: { isEligible: true } } },
          { cycleStatuses: { some: { currentState: { in: ['SELECTION', 'INTERVIEW', 'HOPE_PEP'] } } } },
        ],
      },
      include: {
        allocations: { where: { status: { not: 'REJECTED' } } },
        preferences: { include: { domain: true }, orderBy: { preferenceRank: 'asc' } },
      },
    });

    const unallocated = eligible.filter((s) => s.allocations.length === 0);

    const agentRun = await this.prisma.agentRun.create({
      data: {
        state: 'RUNNING',
        context: { eligiblePoolSize: eligible.length, unallocated: unallocated.length } as any,
      },
    });

    const created: Array<{
      id: string;
      studentId: string;
      recommendedDomain: string;
      rationale: string[];
      conflicts: string[];
      status: string;
    }> = [];

    for (const student of unallocated) {
      const existingRec = await this.prisma.agentRecommendation.findFirst({
        where: { studentId: student.studentId, status: 'PENDING_APPROVAL' },
      });
      if (existingRec) {
        created.push({
          id: existingRec.id,
          studentId: existingRec.studentId,
          recommendedDomain: existingRec.recommendedDomain,
          rationale: existingRec.rationale as string[],
          conflicts: existingRec.conflicts as string[],
          status: existingRec.status,
        });
        continue;
      }

      const analysis = await this.getOrCreateAnalysis(student.studentId);
      const domains = (analysis?.recommendedDomains as any[]) ?? [];
      const domain = domains[0]?.domain;
      if (!domain) continue;

      const { totalCapacity, currentAllocated } = await this.getDomainCapacity(domain);
      const conflicts: string[] = [];
      if (totalCapacity === 0) conflicts.push('Unknown domain capacity');
      else if (currentAllocated >= totalCapacity) conflicts.push('Domain is at capacity');

      const recommendation = await this.prisma.agentRecommendation.create({
        data: {
          runId: agentRun.id,
          studentId: student.studentId,
          recommendedDomain: domain,
          rationale: [domains[0]?.reason ?? 'Top recommendation', `Capacity ${currentAllocated}/${totalCapacity}`] as any,
          conflicts: conflicts as any,
          status: 'PENDING_APPROVAL',
        },
      });

      created.push({
        id: recommendation.id,
        studentId: recommendation.studentId,
        recommendedDomain: recommendation.recommendedDomain,
        rationale: recommendation.rationale as string[],
        conflicts: recommendation.conflicts as string[],
        status: recommendation.status,
      });
    }

    await this.prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        state: 'AWAITING_AUTHORIZED_APPROVAL',
        completedAt: new Date(),
        context: {
          eligiblePoolSize: eligible.length,
          unallocated: unallocated.length,
          recommendations: created.length,
        } as any,
      },
    });

    return {
      runId: agentRun.id,
      eligiblePoolSize: eligible.length,
      recommendations: created,
      state: 'AWAITING_AUTHORIZED_APPROVAL',
    };
  }

  async approve(id: string, approverId: string, decision: 'APPROVE' | 'REJECT') {
    const recommendation = await this.prisma.agentRecommendation.findUnique({ where: { id } });
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    if (recommendation.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Recommendation already decided');
    }

    if (decision === 'APPROVE') {
      await this.assertCanApply(recommendation);
    }

    let finalStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    if (decision === 'APPROVE') {
      const student = await this.prisma.student.findFirst({
        where: { studentId: recommendation.studentId },
      });
      if (student) {
        const domain = await this.prisma.domain.findFirst({
          where: {
            OR: [
              { code: recommendation.recommendedDomain },
              { name: recommendation.recommendedDomain },
            ],
          },
          include: { trainingBatches: { where: { isActive: true } } },
        });

        if (domain) {
          const batch = domain.trainingBatches.find((b) => b.currentAllocated < b.maxCapacity);

          const existingAllocation = await this.prisma.allocation.findFirst({
            where: { studentId: student.id },
          });

          if (!existingAllocation) {
            await this.prisma.allocation.create({
              data: {
                studentId: student.id,
                selectionCycleId: (await this.getActiveCycleId()) ?? '',
                domainId: domain.id,
                trainingBatchId: batch?.id ?? null,
                status: 'PENDING_APPROVAL',
                preferenceRankUsed: 1,
              },
            });

            if (batch) {
              await this.prisma.trainingBatch.update({
                where: { id: batch.id },
                data: { currentAllocated: { increment: 1 } },
              });
            }
          }
        }
      }

      finalStatus = 'VERIFIED';
    }

    const updated = await this.prisma.agentRecommendation.update({
      where: { id },
      data: {
        status: finalStatus as any,
        approvedBy: approverId,
        approvedAt: new Date(),
        verifiedAt: decision === 'APPROVE' ? new Date() : undefined,
      },
    });

    return {
      id: updated.id,
      studentId: updated.studentId,
      recommendedDomain: updated.recommendedDomain,
      rationale: updated.rationale,
      conflicts: updated.conflicts,
      status: updated.status,
      approvedBy: updated.approvedBy,
      approvedAt: updated.approvedAt?.toISOString(),
      verifiedAt: updated.verifiedAt?.toISOString(),
    };
  }

  async list() {
    const recs = await this.prisma.agentRecommendation.findMany({
      orderBy: { run: { startedAt: 'desc' } },
    });
    return recs.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      recommendedDomain: r.recommendedDomain,
      rationale: r.rationale,
      conflicts: r.conflicts,
      status: r.status,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString(),
      verifiedAt: r.verifiedAt?.toISOString(),
    }));
  }

  private async getOrCreateAnalysis(studentId: string) {
    const existing = await this.prisma.aiStudentAnalysis.findFirst({
      where: { studentId },
      orderBy: { generatedAt: 'desc' },
    });
    if (existing) return existing;
    const result = await this.ai.analyze(studentId);
    return {
      recommendedDomains: result.recommendedDomains,
    };
  }

  private async getDomainCapacity(domainName: string) {
    const domain = await this.prisma.domain.findFirst({
      where: { OR: [{ code: domainName }, { name: domainName }] },
      include: { trainingBatches: { where: { isActive: true } } },
    });
    if (!domain) return { totalCapacity: 0, currentAllocated: 0 };
    const totalCapacity = domain.trainingBatches.reduce((sum, b) => sum + b.maxCapacity, 0);
    const currentAllocated = await this.prisma.allocation.count({
      where: { domainId: domain.id, status: { not: 'REJECTED' } },
    });
    return { totalCapacity, currentAllocated };
  }

  private async assertCanApply(recommendation: { recommendedDomain: string; conflicts: unknown }) {
    const conflicts = recommendation.conflicts as string[];
    if (conflicts.length) {
      throw new BadRequestException(`Cannot apply: ${conflicts.join(', ')}`);
    }
    const { totalCapacity, currentAllocated } = await this.getDomainCapacity(recommendation.recommendedDomain);
    if (currentAllocated >= totalCapacity) {
      throw new BadRequestException('Capacity changed before approval; rerun required');
    }
  }

  private async getActiveCycleId(): Promise<string | null> {
    const cycle = await this.prisma.selectionCycle.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return cycle?.id ?? null;
  }
}
