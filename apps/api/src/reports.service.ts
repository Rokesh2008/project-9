import { Injectable } from '@nestjs/common';
import { DOMAIN_CAPACITIES } from './domain';
import { Store } from './store';

@Injectable()
export class ReportsService {
  constructor(private readonly store: Store) {}

  selectionSummary() {
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

  domainCapacity() {
    return Object.entries(DOMAIN_CAPACITIES).map(([domain, capacity]) => {
      const demand = [...this.store.students.values()].filter((student) => student.preferences.includes(domain)).length;
      const allocated = [...this.store.allocations.values()].filter((value) => value === domain).length;
      return { domain, capacity, demand, allocated, available: capacity - allocated, overSubscribed: demand > capacity };
    });
  }

  eligibilityFailures() {
    return [...this.store.students.values()].filter((student) => !student.interviewEligible).map((student) => {
      const reasons: string[] = [];
      if (student.codingScore < 70) reasons.push('Coding score below 70');
      if (student.attendancePercent < 75) reasons.push('Attendance below 75%');
      if (!student.completedCertificates.length) reasons.push('Missing prerequisite certificate');
      if (!student.preferences.length) reasons.push('Missing domain preference');
      return { studentId: student.studentId, registerNumber: student.registerNumber, name: student.name, program: student.program, reasons };
    });
  }

  performance() {
    return [...this.store.students.values()].map((student) => {
      const communication = [...this.store.communicationResults.values()].filter((result) => result.studentId === student.studentId);
      const interviews = [...this.store.interviewResults.values()].filter((result) => result.studentId === student.studentId);
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

  auditTrail() { return [...this.store.auditEvents].reverse(); }

  selectionCsv() {
    const header = ['studentId', 'registerNumber', 'name', 'program', 'interviewEligible', 'selected', 'allocatedDomain'];
    const rows = [...this.store.students.values()].map((student) => [
      student.studentId, student.registerNumber, student.name, student.program,
      student.interviewEligible, student.selected, this.store.allocations.get(student.studentId) ?? '',
    ]);
    return this.csv([header, ...rows]);
  }

  capacityCsv() {
    return this.csv([
      ['domain', 'capacity', 'demand', 'allocated', 'available', 'overSubscribed'],
      ...this.domainCapacity().map((row) => [row.domain, row.capacity, row.demand, row.allocated, row.available, row.overSubscribed]),
    ]);
  }

  private csv(rows: Array<Array<string | number | boolean>>) {
    return rows.map((row) => row.map((value) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(',')).join('\n') + '\n';
  }
}
