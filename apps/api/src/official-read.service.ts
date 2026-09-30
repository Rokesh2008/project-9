import { Injectable } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { Store } from './store';

@Injectable()
export class OfficialReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: Store,
  ) {}

  enabled() {
    return (
      (process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() === 'postgres' ||
      (process.env.OFFICIAL_PROJECTION ?? 'false').toLowerCase() === 'true'
    );
  }

  async listStudents() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) return [];

    const statuses = await this.prisma.studentCycleStatus.findMany({
      where: { selectionCycleId: cycle.id },
      include: {
        student: {
          include: {
            assessmentResults: true,
            batch: { include: { department: true } },
          },
        },
      },
      orderBy: { student: { studentId: 'asc' } },
    });
    const [classifications, eligibility, allocations] = await Promise.all([
      this.prisma.hopePepClassification.findMany({
        where: { selectionCycleId: cycle.id },
      }),
      this.prisma.eligibilityResult.findMany({
        where: { selectionCycleId: cycle.id },
      }),
      this.prisma.allocation.findMany({
        where: { selectionCycleId: cycle.id, status: { not: 'REJECTED' } },
        include: { domain: true },
      }),
    ]);

    const classificationByStudent = new Map(
      classifications.map((item) => [item.studentId, item]),
    );
    const eligibilityByStudent = new Map(
      eligibility.map((item) => [item.studentId, item]),
    );
    const allocationByStudent = new Map(
      allocations.map((item) => [item.studentId, item]),
    );

    return statuses.map((status) => {
      const student = status.student;
      const classification = classificationByStudent.get(student.id);
      const eligibilityResult = eligibilityByStudent.get(student.id);
      const allocation = allocationByStudent.get(student.id);
      const highest = (type: string) =>
        student.assessmentResults
          .filter((result) => result.assessmentType === type)
          .reduce((max, result) => Math.max(max, result.score), 0);

      return {
        studentId: student.studentId,
        internalStudentId: student.id,
        registerNumber: student.registerNumber ?? student.studentId,
        name: student.name,
        email: student.email,
        department: student.batch.department.code,
        batchIdentifier: student.batch.batchIdentifier,
        program: classification?.program ?? 'UNASSIGNED',
        codingScore: highest('CODING'),
        aptitudeScore: highest('APTITUDE'),
        attendancePercent: student.attendancePercent ?? 0,
        cgpa: student.cgpa ?? 0,
        dsaLevel: student.dsaLevel ?? 'BEGINNER',
        interviewEligible: this.isInterviewReady(status.currentState),
        selected:
          classification?.program === 'HOPE' || classification?.program === 'PEP',
        eligibility: eligibilityResult?.isEligible ?? false,
        eligibilityFailures: eligibilityResult?.failedRules ?? null,
        allocation: allocation?.domain
          ? `${allocation.domain.code} ${allocation.domain.name}`
          : undefined,
        workflowState: status.currentState,
        selectionCycleId: cycle.id,
      };
    });
  }

  async getStudent(externalStudentId: string) {
    const students = await this.listStudents();
    if (!students) return null;
    return students.find((student) => student.studentId === externalStudentId) ?? null;
  }

  async selectionSummary() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) {
      return {
        totalStudents: 0,
        interviewEligible: 0,
        selected: 0,
        allocated: 0,
        byProgram: {},
        integrationFailures: this.store.logs.filter((log) => log.status === 'FAILED').length,
      };
    }

    const [statuses, classifications, allocated] = await Promise.all([
      this.prisma.studentCycleStatus.findMany({
        where: { selectionCycleId: cycle.id },
        select: { currentState: true },
      }),
      this.prisma.hopePepClassification.findMany({
        where: { selectionCycleId: cycle.id },
        select: { program: true },
      }),
      this.prisma.allocation.count({
        where: {
          selectionCycleId: cycle.id,
          status: { in: ['APPROVED', 'FROZEN'] },
        },
      }),
    ]);

    const byProgram = classifications.reduce<Record<string, number>>((acc, item) => {
      acc[item.program] = (acc[item.program] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalStudents: statuses.length,
      interviewEligible: statuses.filter((item) =>
        this.isInterviewReady(item.currentState),
      ).length,
      selected: classifications.filter(
        (item) => item.program === 'HOPE' || item.program === 'PEP',
      ).length,
      allocated,
      byProgram,
      integrationFailures: this.store.logs.filter((log) => log.status === 'FAILED').length,
      selectionCycleId: cycle.id,
    };
  }

  async domainCapacity() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) return [];

    const domains = await this.prisma.domain.findMany({
      where: { isActive: true },
      include: { trainingBatches: { where: { isActive: true } } },
      orderBy: { code: 'asc' },
    });

    const rows = [];
    for (const domain of domains) {
      const [demand, allocated] = await Promise.all([
        this.prisma.studentPreference.count({
          where: { selectionCycleId: cycle.id, domainId: domain.id },
        }),
        this.prisma.allocation.count({
          where: {
            selectionCycleId: cycle.id,
            domainId: domain.id,
            status: { not: 'REJECTED' },
          },
        }),
      ]);
      const capacity = domain.trainingBatches.reduce(
        (sum, batch) => sum + batch.maxCapacity,
        0,
      );
      rows.push({
        domain: `${domain.code} ${domain.name}`,
        capacity,
        demand,
        allocated,
        available: Math.max(0, capacity - allocated),
        overSubscribed: demand > capacity,
      });
    }
    return rows;
  }

  async eligibilityFailures() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) return [];

    const failures = await this.prisma.eligibilityResult.findMany({
      where: { selectionCycleId: cycle.id, isEligible: false },
      include: { student: true },
      orderBy: { evaluatedAt: 'desc' },
    });
    const classifications = await this.prisma.hopePepClassification.findMany({
      where: { selectionCycleId: cycle.id },
    });
    const programs = new Map(
      classifications.map((item) => [item.studentId, item.program]),
    );

    return failures.map((item) => ({
      studentId: item.student.studentId,
      registerNumber: item.student.registerNumber ?? item.student.studentId,
      name: item.student.name,
      program: programs.get(item.studentId) ?? 'UNASSIGNED',
      reasons: this.failedRuleMessages(item.failedRules),
    }));
  }

  async performance() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) return [];

    const statuses = await this.prisma.studentCycleStatus.findMany({
      where: { selectionCycleId: cycle.id },
      include: { student: { include: { assessmentResults: true } } },
    });

    return statuses.map(({ student }) => {
      const communication = student.assessmentResults
        .filter((result) => result.assessmentType === 'COMMUNICATION')
        .sort((a, b) => a.assessmentDate.getTime() - b.assessmentDate.getTime());
      const interviews = student.assessmentResults
        .filter((result) => result.assessmentType === 'INTERVIEW')
        .sort((a, b) => a.assessmentDate.getTime() - b.assessmentDate.getTime());

      const latestInterview = interviews.at(-1);
      const latestMetadata = latestInterview?.metadata as
        | { outcome?: string }
        | null
        | undefined;

      return {
        studentId: student.studentId,
        name: student.name,
        communicationAttempts: communication.length,
        latestCommunicationScore: communication.at(-1)?.score ?? null,
        interviewAttempts: interviews.length,
        latestInterviewScore: latestInterview?.score ?? null,
        latestInterviewOutcome: latestMetadata?.outcome ?? null,
      };
    });
  }

  async auditTrail() {
    if (!this.enabled()) return null;
    const cycle = await this.latestCycle();
    if (!cycle) return [];

    const [workflow, decision] = await Promise.all([
      this.prisma.workflowAuditLog.findMany({
        where: { selectionCycleId: cycle.id },
        orderBy: { createdAt: 'desc' },
        take: 250,
      }),
      this.prisma.scoreAuditLog.findMany({
        where: { selectionCycleId: cycle.id },
        orderBy: { createdAt: 'desc' },
        take: 250,
      }),
    ]);

    return [
      ...workflow.map((item) => ({
        type: 'WORKFLOW',
        at: item.createdAt,
        actorId: item.actor,
        entityId: item.studentId,
        details: {
          fromState: item.fromState,
          toState: item.toState,
          reason: item.reason,
        },
      })),
      ...decision.map((item) => ({
        type: item.action,
        at: item.createdAt,
        actorId: item.actor,
        entityId: item.entityId,
        details: item.metadata,
      })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  async selectionCsv() {
    const students = await this.listStudents();
    if (!students) return null;
    return this.csv([
      [
        'studentId',
        'registerNumber',
        'name',
        'program',
        'eligibility',
        'selected',
        'workflowState',
        'allocatedDomain',
      ],
      ...students.map((student) => [
        student.studentId,
        student.registerNumber,
        student.name,
        student.program,
        student.eligibility,
        student.selected,
        student.workflowState,
        student.allocation ?? '',
      ]),
    ]);
  }

  async capacityCsv() {
    const rows = await this.domainCapacity();
    if (!rows) return null;
    return this.csv([
      ['domain', 'capacity', 'demand', 'allocated', 'available', 'overSubscribed'],
      ...rows.map((row) => [
        row.domain,
        row.capacity,
        row.demand,
        row.allocated,
        row.available,
        row.overSubscribed,
      ]),
    ]);
  }

  private async latestCycle() {
    return this.prisma.selectionCycle.findFirst({
      where: { status: { in: ['ACTIVE', 'FROZEN'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private isInterviewReady(state: string) {
    return ['INTERVIEW', 'SELECTION', 'ALLOCATION', 'FINALIZED', 'FROZEN'].includes(
      state,
    );
  }

  private failedRuleMessages(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (item && typeof item === 'object' && 'message' in item) {
        return String((item as { message: unknown }).message);
      }
      return String(item);
    });
  }

  private csv(rows: Array<Array<string | number | boolean | null | undefined>>) {
    return (
      rows
        .map((row) =>
          row
            .map((value) => {
              const text = String(value ?? '');
              return /[",\n]/.test(text)
                ? `"${text.replaceAll('"', '""')}"`
                : text;
            })
            .join(','),
        )
        .join('\n') + '\n'
    );
  }
}
