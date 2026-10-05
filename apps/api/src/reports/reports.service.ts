import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async selectionSummary() {
    const [
      totalStudents,
      eligibleCount,
      selectedCount,
      allocatedCount,
      needsReview,
      integrationFailures,
    ] = await Promise.all([
      this.prisma.student.count(),
      this.prisma.eligibilityResult.count({ where: { isEligible: true } }),
      this.prisma.allocation.count({ where: { status: { not: 'REJECTED' } } }),
      this.prisma.allocation.count({ where: { status: { in: ['APPROVED', 'FROZEN'] } } }),
      this.prisma.allocation.count({ where: { status: { in: ['PENDING_APPROVAL', 'MANUAL_REVIEW'] } } }),
      this.prisma.integrationJob.count({ where: { status: 'FAILED' } }).catch(() => 0),
    ]);

    const classifications = await this.prisma.hopePepClassification.groupBy({
      by: ['program'],
      _count: true,
    }).catch(() => []);

    const byProgram: Record<string, number> = {};
    for (const c of classifications) {
      byProgram[c.program] = c._count;
    }

    return {
      totalStudents,
      interviewEligible: eligibleCount,
      selected: selectedCount,
      allocated: allocatedCount,
      needsReview,
      byProgram,
      integrationFailures,
    };
  }

  async domainCapacity() {
    const domains = await this.prisma.domain.findMany({
      include: {
        trainingBatches: { where: { isActive: true } },
        preferences: true,
        allocations: { where: { status: { not: 'REJECTED' } } },
      },
    });

    return domains.map((domain) => {
      const capacity = domain.trainingBatches.reduce((sum, b) => sum + b.maxCapacity, 0);
      const demand = domain.preferences.length;
      const allocated = domain.allocations.length;
      return {
        domain: `${domain.code} ${domain.name}`,
        domainCode: domain.code,
        domainName: domain.name,
        capacity,
        demand,
        allocated,
        available: capacity - allocated,
        overSubscribed: demand > capacity,
      };
    });
  }

  async eligibilityFailures() {
    const failures = await this.prisma.eligibilityResult.findMany({
      where: { isEligible: false },
      include: { student: true },
      orderBy: { evaluatedAt: 'desc' },
    });

    return failures.map((f) => ({
      studentId: f.student.studentId,
      name: f.student.name,
      reasons: Array.isArray(f.failedRules) ? (f.failedRules as any[]).map((r: any) => r.message ?? r) : [],
      evaluatedAt: f.evaluatedAt.toISOString(),
    }));
  }

  async performance() {
    const students = await this.prisma.student.findMany({
      include: {
        assessmentResults: {
          where: { assessmentType: { in: ['COMMUNICATION', 'INTERVIEW'] } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return students.map((student) => {
      const communication = student.assessmentResults.filter((r) => r.assessmentType === 'COMMUNICATION');
      const interviews = student.assessmentResults.filter((r) => r.assessmentType === 'INTERVIEW');
      return {
        studentId: student.studentId,
        name: student.name,
        communicationAttempts: communication.length,
        latestCommunicationScore: communication.at(-1)?.score ?? null,
        interviewAttempts: interviews.length,
        latestInterviewScore: interviews.at(-1)?.score ?? null,
        latestInterviewOutcome: (interviews.at(-1)?.metadata as any)?.outcome ?? null,
      };
    });
  }

  async auditTrail() {
    const [workflowAudits, scoreAudits] = await Promise.all([
      this.prisma.workflowAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { student: true },
      }),
      this.prisma.scoreAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const merged = [
      ...workflowAudits.map((a) => ({
        type: `${a.fromState}_TO_${a.toState}`,
        actorId: a.actor,
        role: a.role,
        entityId: a.studentId,
        studentId: a.student?.studentId ?? a.studentId,
        details: { fromState: a.fromState, toState: a.toState, reason: a.reason },
        at: a.createdAt.toISOString(),
        source: 'workflow' as const,
      })),
      ...scoreAudits.map((a) => ({
        type: a.action,
        actorId: a.actor,
        role: a.role,
        entityId: a.entityId ?? a.id,
        studentId: a.entityId,
        details: { previousValue: a.previousValue, newValue: a.newValue, reason: a.reason },
        at: a.createdAt.toISOString(),
        source: 'score' as const,
      })),
    ];

    merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return merged.slice(0, 200);
  }

  async selectionCsv() {
    const students = await this.prisma.student.findMany({
      include: {
        eligibilityResults: { orderBy: { evaluatedAt: 'desc' }, take: 1 },
        hopePepClassifications: { orderBy: { classifiedAt: 'desc' }, take: 1 },
        allocations: { include: { domain: true }, where: { status: { not: 'REJECTED' } }, take: 1 },
      },
    });

    const header = ['studentId', 'name', 'eligible', 'program', 'allocatedDomain', 'allocationStatus'];
    const rows = students.map((s) => [
      s.studentId,
      s.name,
      s.eligibilityResults[0]?.isEligible ?? '',
      s.hopePepClassifications[0]?.program ?? '',
      s.allocations[0]?.domain?.name ?? '',
      s.allocations[0]?.status ?? '',
    ]);
    return this.csv([header, ...rows]);
  }

  async capacityCsv() {
    const data = await this.domainCapacity();
    return this.csv([
      ['domain', 'capacity', 'demand', 'allocated', 'available', 'overSubscribed'],
      ...data.map((row) => [row.domain, row.capacity, row.demand, row.allocated, row.available, row.overSubscribed]),
    ]);
  }

  private csv(rows: Array<Array<string | number | boolean>>) {
    return rows.map((row) => row.map((value) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',')).join('\n') + '\n';
  }
}
