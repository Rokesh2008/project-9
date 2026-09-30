import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AllocationService } from './allocation/allocation.service';
import { PrismaService } from './common/prisma.service';
import { AgentRecommendation, CanonicalStudent, DOMAIN_CAPACITIES } from './domain';
import { AiService } from './ai.service';
import { Store } from './store';

@Injectable()
export class AgentService {
  constructor(
    private readonly store: Store,
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
    private readonly allocation: AllocationService,
  ) {}

  async run(selectionCycleId?: string) {
    return this.officialEnabled()
      ? this.runOfficial(selectionCycleId)
      : this.runStandalone();
  }

  async approve(
    id: string,
    approverId: string,
    decision: 'APPROVE' | 'REJECT',
  ) {
    const recommendation = this.store.recommendations.get(id);
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    if (recommendation.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Recommendation already decided');
    }

    if (decision === 'REJECT') {
      recommendation.status = 'REJECTED';
    } else if (this.officialEnabled() && recommendation.selectionCycleId) {
      if (recommendation.conflicts.length) {
        throw new BadRequestException(
          `Cannot apply: ${recommendation.conflicts.join(', ')}`,
        );
      }
      await this.applyOfficial(recommendation, approverId);
    } else {
      this.assertCanApplyStandalone(recommendation);
      recommendation.status = 'APPROVED';
      this.applyStandalone(recommendation);
    }

    recommendation.approvedBy = approverId;
    recommendation.approvedAt = new Date().toISOString();
    this.store.auditEvents.push({
      type: `AGENT_RECOMMENDATION_${decision}`,
      actorId: approverId,
      entityId: recommendation.id,
      details: {
        studentId: recommendation.studentId,
        domain: recommendation.recommendedDomain,
        finalStatus: recommendation.status,
      },
      at: new Date().toISOString(),
    });
    this.store.persist();
    return recommendation;
  }

  list() {
    return [...this.store.recommendations.values()];
  }

  private async runStandalone() {
    const eligible = [...this.store.students.values()].filter(
      (s) =>
        (s.interviewEligible || s.selected) &&
        !this.store.allocations.has(s.studentId),
    );
    const created: AgentRecommendation[] = [];

    for (const student of eligible) {
      const existing = this.pendingFor(student.studentId);
      if (existing) {
        created.push(existing);
        continue;
      }

      const analysis =
        this.store.analyses.get(student.studentId) ??
        (await this.ai.analyze(student.studentId));
      const domain = analysis.recommendedDomains[0]?.domain;
      if (!domain) continue;

      const used = [...this.store.allocations.values()].filter(
        (value) => value === domain,
      ).length;
      const capacity = DOMAIN_CAPACITIES[domain] ?? 0;
      const conflicts =
        capacity === 0
          ? ['Unknown domain capacity']
          : used >= capacity
            ? ['Domain is at capacity']
            : [];

      const recommendation: AgentRecommendation = {
        id: randomUUID(),
        studentId: student.studentId,
        recommendedDomain: domain,
        rationale: [
          analysis.recommendedDomains[0].reason,
          `Capacity ${used}/${capacity}`,
        ],
        conflicts,
        status: 'PENDING_APPROVAL',
      };
      this.store.recommendations.set(recommendation.id, recommendation);
      created.push(recommendation);
    }

    return this.finishRun(eligible.length, created);
  }

  private async runOfficial(selectionCycleId?: string) {
    const cycleId = await this.resolveOfficialCycle(selectionCycleId);
    const existingAllocationStudents = new Set(
      (
        await this.prisma.allocation.findMany({
          where: { selectionCycleId: cycleId },
          select: { studentId: true },
        })
      ).map((item) => item.studentId),
    );
    const classifications = await this.prisma.hopePepClassification.findMany({
      where: {
        selectionCycleId: cycleId,
        program: { in: ['HOPE', 'PEP'] },
      },
      orderBy: { rank: 'asc' },
      include: { student: true },
    });

    const eligible = classifications.filter(
      (item) => !existingAllocationStudents.has(item.studentId),
    );
    const created: AgentRecommendation[] = [];

    for (const item of eligible) {
      const externalStudentId = item.student.studentId;
      const existing = this.pendingFor(externalStudentId, cycleId);
      if (existing) {
        created.push(existing);
        continue;
      }

      await this.ensureCanonicalStudent(item.studentId, cycleId, item.program);
      const analysis =
        this.store.analyses.get(externalStudentId) ??
        (await this.ai.analyze(externalStudentId));
      const domain = analysis.recommendedDomains[0]?.domain;
      if (!domain) continue;

      const capacity = await this.officialCapacity(domain, cycleId);
      const conflicts =
        capacity.capacity === 0
          ? ['Unknown domain capacity']
          : capacity.used >= capacity.capacity
            ? ['Domain is at capacity']
            : [];
      const recommendation: AgentRecommendation = {
        id: randomUUID(),
        studentId: externalStudentId,
        selectionCycleId: cycleId,
        recommendedDomain: domain,
        rationale: [
          analysis.recommendedDomains[0].reason,
          `Capacity ${capacity.used}/${capacity.capacity}`,
        ],
        conflicts,
        status: 'PENDING_APPROVAL',
      };
      this.store.recommendations.set(recommendation.id, recommendation);
      created.push(recommendation);
    }

    return this.finishRun(eligible.length, created, cycleId);
  }

  private finishRun(
    eligiblePoolSize: number,
    recommendations: AgentRecommendation[],
    selectionCycleId?: string,
  ) {
    const runId = randomUUID();
    this.store.auditEvents.push({
      type: 'AGENT_RUN_COMPLETED',
      actorId: 'selection-agent',
      entityId: runId,
      details: {
        selectionCycleId: selectionCycleId ?? null,
        eligiblePoolSize,
        recommendations: recommendations.length,
      },
      at: new Date().toISOString(),
    });
    this.store.persist();
    return {
      runId,
      selectionCycleId,
      eligiblePoolSize,
      recommendations,
      state: 'AWAITING_AUTHORIZED_APPROVAL',
    };
  }

  private async applyOfficial(
    recommendation: AgentRecommendation,
    approverId: string,
  ) {
    const cycleId = recommendation.selectionCycleId;
    if (!cycleId) throw new BadRequestException('Selection cycle is missing');

    const domainCode = this.domainCode(recommendation.recommendedDomain);
    if (!domainCode) throw new BadRequestException('Recommended domain code is invalid');

    await this.allocation.applyApprovedRecommendation(
      recommendation.studentId,
      cycleId,
      domainCode,
      approverId,
      `Approved selection-agent recommendation: ${recommendation.rationale.join('; ')}`,
    );

    const student = await this.prisma.student.findUnique({
      where: { studentId: recommendation.studentId },
    });
    const official = student
      ? await this.prisma.allocation.findUnique({
          where: {
            studentId_selectionCycleId: {
              studentId: student.id,
              selectionCycleId: cycleId,
            },
          },
          include: { domain: true },
        })
      : null;
    if (!official || official.domain?.code !== domainCode) {
      throw new BadRequestException('Official allocation verification failed');
    }

    this.store.allocations.set(
      recommendation.studentId,
      recommendation.recommendedDomain,
    );
    recommendation.status = 'VERIFIED';
    recommendation.verifiedAt = new Date().toISOString();
  }

  private applyStandalone(recommendation: AgentRecommendation) {
    this.store.allocations.set(
      recommendation.studentId,
      recommendation.recommendedDomain,
    );
    if (
      this.store.allocations.get(recommendation.studentId) !==
      recommendation.recommendedDomain
    ) {
      throw new BadRequestException('Allocation verification failed');
    }
    recommendation.status = 'VERIFIED';
    recommendation.verifiedAt = new Date().toISOString();
  }

  private assertCanApplyStandalone(recommendation: AgentRecommendation) {
    if (recommendation.conflicts.length) {
      throw new BadRequestException(
        `Cannot apply: ${recommendation.conflicts.join(', ')}`,
      );
    }
    const capacity = DOMAIN_CAPACITIES[recommendation.recommendedDomain] ?? 0;
    const used = [...this.store.allocations.values()].filter(
      (domain) => domain === recommendation.recommendedDomain,
    ).length;
    if (used >= capacity) {
      throw new BadRequestException(
        'Capacity changed before approval; rerun required',
      );
    }
  }

  private pendingFor(studentId: string, selectionCycleId?: string) {
    return [...this.store.recommendations.values()].find(
      (item) =>
        item.studentId === studentId &&
        item.status === 'PENDING_APPROVAL' &&
        (!selectionCycleId || item.selectionCycleId === selectionCycleId),
    );
  }

  private officialEnabled() {
    return (
      (process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() === 'postgres' ||
      (process.env.OFFICIAL_PROJECTION ?? 'false').toLowerCase() === 'true'
    );
  }

  private async resolveOfficialCycle(selectionCycleId?: string) {
    if (selectionCycleId) {
      const cycle = await this.prisma.selectionCycle.findUnique({
        where: { id: selectionCycleId },
      });
      if (!cycle) throw new NotFoundException('Selection cycle not found');
      return cycle.id;
    }

    const active = await this.prisma.selectionCycle.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    if (active.length !== 1) {
      throw new BadRequestException(
        'selectionCycleId is required when there is not exactly one active cycle',
      );
    }
    return active[0].id;
  }

  private async officialCapacity(domain: string, selectionCycleId: string) {
    const code = this.domainCode(domain);
    if (!code) return { capacity: 0, used: 0 };

    const record = await this.prisma.domain.findUnique({
      where: { code },
      include: { trainingBatches: { where: { isActive: true } } },
    });
    if (!record) return { capacity: 0, used: 0 };

    const capacity = record.trainingBatches.reduce(
      (sum, batch) => sum + batch.maxCapacity,
      0,
    );
    const used = await this.prisma.allocation.count({
      where: {
        selectionCycleId,
        domainId: record.id,
        status: { not: 'REJECTED' },
      },
    });
    return { capacity, used };
  }

  private domainCode(domain: string) {
    return domain.trim().match(/^(PEPC-\d+)/i)?.[1]?.toUpperCase();
  }

  private async ensureCanonicalStudent(
    internalStudentId: string,
    selectionCycleId: string,
    program: string,
  ) {
    const official = await this.prisma.student.findUnique({
      where: { id: internalStudentId },
      include: {
        assessmentResults: true,
        credentials: { where: { verificationStatus: 'VERIFIED' } },
        preferences: {
          where: { selectionCycleId },
          orderBy: { preferenceRank: 'asc' },
          include: { domain: true },
        },
        batch: { include: { department: true } },
      },
    });
    if (!official) throw new NotFoundException('Student not found');

    const highest = (type: string) =>
      official.assessmentResults
        .filter((item) => item.assessmentType === type)
        .reduce((max, item) => Math.max(max, item.score), 0);

    const canonical: CanonicalStudent = {
      studentId: official.studentId,
      registerNumber: official.registerNumber ?? official.studentId,
      name: official.name,
      department: official.batch.department.code,
      email: official.email ?? undefined,
      cgpa: official.cgpa ?? 0,
      codingScore: highest('CODING'),
      aptitudeScore: highest('APTITUDE'),
      attendancePercent: official.attendancePercent ?? 0,
      dsaLevel:
        official.dsaLevel === 'ADVANCED' || official.dsaLevel === 'INTERMEDIATE'
          ? official.dsaLevel
          : 'BEGINNER',
      preferences: official.preferences.map(
        (preference) =>
          `${preference.domain.code} ${preference.domain.name}`,
      ),
      completedCertificates: official.credentials.map((item) => item.name),
      program:
        program === 'HOPE' || program === 'PEP' ? program : 'UNASSIGNED',
      interviewEligible: true,
      selected: program === 'HOPE' || program === 'PEP',
      sourceUpdatedAt:
        official.sourceUpdatedAt?.toISOString() ??
        official.updatedAt.toISOString(),
    };

    this.store.students.set(official.studentId, canonical);
    this.store.persist();
  }
}
