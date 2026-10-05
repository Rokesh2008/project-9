import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WhatIfDto } from './dto';
import { DOMAIN_CAPACITIES } from './domain';
import { Store } from './store';

@Injectable()
export class IntelligenceService {
  constructor(@Inject(Store) private readonly store: Store) {}

  whatIf(studentId: string, overrides: WhatIfDto) {
    const source = this.store.students.get(studentId);
    if (!source) throw new NotFoundException('Student not found');
    const definedOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
    const projected = { ...source, ...definedOverrides };
    const reasons: string[] = [];
    if (projected.codingScore < 70) reasons.push('Coding score below 70');
    if (projected.attendancePercent < 75) reasons.push('Attendance below 75%');
    if (!projected.completedCertificates.length) reasons.push('Missing prerequisite certificate');
    if (!projected.preferences.length) reasons.push('Missing domain preference');
    const bestDomain = projected.preferences[0];
    const capacity = bestDomain ? DOMAIN_CAPACITIES[bestDomain] ?? 0 : 0;
    const allocated = bestDomain ? [...this.store.allocations.values()].filter((domain) => domain === bestDomain).length : 0;
    return {
      studentId,
      advisoryOnly: true,
      original: { interviewEligible: source.interviewEligible, firstPreference: source.preferences[0] },
      projected: {
        interviewEligible: reasons.length === 0,
        reasons,
        firstPreference: bestDomain,
        capacityAvailable: Math.max(0, capacity - allocated),
        recommendationScore: Math.round(projected.codingScore * 0.45 + projected.aptitudeScore * 0.25 + projected.cgpa * 3),
      },
      changedFields: Object.keys(definedOverrides),
      mutatedOfficialRecord: false,
    };
  }

  anomalies() {
    const students = [...this.store.students.values()];
    const registerCounts = this.count(students.map((student) => student.registerNumber));
    const emailCounts = this.count(students.map((student) => student.email ?? ''));
    return students.flatMap((student) => {
      const findings: Array<{ studentId: string; severity: string; type: string; detail: string }> = [];
      if ((registerCounts[student.registerNumber] ?? 0) > 1) findings.push({ studentId: student.studentId, severity: 'HIGH', type: 'DUPLICATE_REGISTER_NUMBER', detail: student.registerNumber });
      if (student.email && (emailCounts[student.email] ?? 0) > 1) findings.push({ studentId: student.studentId, severity: 'HIGH', type: 'DUPLICATE_EMAIL', detail: student.email });
      if (!student.preferences.length) findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'MISSING_PREFERENCE', detail: 'No domain preference' });
      if (!student.completedCertificates.length) findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'MISSING_CERTIFICATE', detail: 'No prerequisite certificate' });
      for (const preference of student.preferences) {
        if (!(preference in DOMAIN_CAPACITIES)) findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'UNKNOWN_DOMAIN', detail: preference });
      }
      return findings;
    });
  }

  private count(values: string[]) {
    return values.reduce<Record<string, number>>((result, value) => {
      if (value) result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {});
  }
}
