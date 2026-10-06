import { Injectable } from '@nestjs/common';
import { DOMAIN_CAPACITIES } from './domain';
import { OfficialReadService } from './official-read.service';
import { Store } from './store';

@Injectable()
export class ReportsService {
  constructor(
    private readonly store: Store,
    private readonly official: OfficialReadService,
  ) {}

  async selectionSummary() {
    const official = await this.official.selectionSummary();
    if (official) return official;

    const students = [...this.store.students.values()];
    const byProgram = students.reduce<Record<string, number>>((acc, student) => {
      acc[student.program] = (acc[student.program] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalStudents: students.length,
      interviewEligible: students.filter((s) => s.interviewEligible).length,
      selected: students.filter((s) => s.selected).length,
      allocated: this.store.allocations.size,
      byProgram,
      integrationFailures: this.store.logs.filter((log) => log.status === 'FAILED').length,
    };
  }

  async domainCapacity() {
    const official = await this.official.domainCapacity();
    if (official) return official;

    return Object.entries(DOMAIN_CAPACITIES).map(([domain, capacity]) => {
      const demand = [...this.store.students.values()].filter((student) =>
        student.preferences.includes(domain),
      ).length;
      const allocated = [...this.store.allocations.values()].filter(
        (value) => value === domain,
      ).length;
      return {
        domain,
        capacity,
        demand,
        allocated,
        available: capacity - allocated,
        overSubscribed: demand > capacity,
      };
    });
  }

  async eligibilityFailures() {
    const official = await this.official.eligibilityFailures();
    if (official) return official;

    return [...this.store.students.values()]
      .filter((student) => !student.interviewEligible)
      .map((student) => {
        const reasons: string[] = [];
        if (student.codingScore < 70) reasons.push('Coding score below 70');
        if (student.attendancePercent < 75) reasons.push('Attendance below 75%');
        if (!student.completedCertificates.length) {
          reasons.push('Missing prerequisite certificate');
        }
        if (!student.preferences.length) reasons.push('Missing domain preference');
        return {
          studentId: student.studentId,
          registerNumber: student.registerNumber,
          name: student.name,
          program: student.program,
          reasons,
        };
      });
  }

  async performance() {
    const official = await this.official.performance();
    if (official) return official;

    return [...this.store.students.values()].map((student) => {
      const communication = [...this.store.communicationResults.values()].filter(
        (result) => result.studentId === student.studentId,
      );
      const interviews = [...this.store.interviewResults.values()].filter(
        (result) => result.studentId === student.studentId,
      );
      return {
        studentId: student.studentId,
        name: student.name,
        communicationAttempts: communication.length,
        latestCommunicationScore: communication.at(-1)?.score ?? null,
        interviewAttempts: interviews.length,
        latestInterviewScore: interviews.at(-1)?.score ?? null,
        latestInterviewOutcome: interviews.at(-1)?.outcome ?? null,
      };
    });
  }

  async auditTrail() {
    const official = await this.official.auditTrail();
    return official ?? [...this.store.auditEvents].reverse();
  }

  async selectionCsv() {
    const official = await this.official.selectionCsv();
    if (official) return official;

    const header = [
      'studentId',
      'registerNumber',
      'name',
      'program',
      'interviewEligible',
      'selected',
      'allocatedDomain',
    ];
    const rows = [...this.store.students.values()].map((student) => [
      student.studentId,
      student.registerNumber,
      student.name,
      student.program,
      student.interviewEligible,
      student.selected,
      this.store.allocations.get(student.studentId) ?? '',
    ]);
    return this.csv([header, ...rows]);
  }

  async capacityCsv() {
    const official = await this.official.capacityCsv();
    if (official) return official;

    const capacity = await this.domainCapacity();
    return this.csv([
      ['domain', 'capacity', 'demand', 'allocated', 'available', 'overSubscribed'],
      ...capacity.map((row) => [
        row.domain,
        row.capacity,
        row.demand,
        row.allocated,
        row.available,
        row.overSubscribed,
      ]),
    ]);
  }

  private csv(rows: Array<Array<string | number | boolean>>) {
    return (
      rows
        .map((row) =>
          row
            .map((value) => {
              const text = String(value);
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
