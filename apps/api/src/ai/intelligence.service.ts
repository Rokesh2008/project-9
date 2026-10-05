import { Injectable, NotFoundException } from '@nestjs/common';
import { WhatIfDto } from '../dto';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async whatIf(studentId: string, overrides: WhatIfDto) {
    const student = await this.prisma.student.findFirst({
      where: { OR: [{ id: studentId }, { studentId }] },
      include: {
        assessmentResults: true,
        preferences: { include: { domain: true }, orderBy: { preferenceRank: 'asc' } },
        allocations: { where: { status: { not: 'REJECTED' } } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const scores = this.extractScores(student.assessmentResults);
    const prefDomains = student.preferences.map((p) => p.domain?.name ?? p.domain?.code ?? '');
    const certs: string[] = this.extractCertificates(student.assessmentResults);

    const original = {
      codingScore: scores.codingScore,
      aptitudeScore: scores.aptitudeScore,
      cgpa: scores.cgpa,
      attendancePercent: scores.attendancePercent,
      preferences: prefDomains,
      completedCertificates: certs,
    };

    const definedOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => value !== undefined),
    );
    const projected = { ...original, ...definedOverrides };

    const reasons: string[] = [];
    if (projected.codingScore < 70) reasons.push('Coding score below 70');
    if (projected.attendancePercent < 75) reasons.push('Attendance below 75%');
    if (!projected.completedCertificates.length) reasons.push('Missing prerequisite certificate');
    if (!projected.preferences.length) reasons.push('Missing domain preference');

    const bestDomain = projected.preferences[0];
    let capacityAvailable = 0;
    if (bestDomain) {
      const domain = await this.prisma.domain.findFirst({
        where: { OR: [{ code: bestDomain }, { name: bestDomain }] },
        include: { trainingBatches: { where: { isActive: true } } },
      });
      if (domain) {
        const totalCapacity = domain.trainingBatches.reduce((sum, b) => sum + b.maxCapacity, 0);
        const allocated = await this.prisma.allocation.count({
          where: { domainId: domain.id, status: { not: 'REJECTED' } },
        });
        capacityAvailable = Math.max(0, totalCapacity - allocated);
      }
    }

    return {
      studentId: student.studentId,
      advisoryOnly: true,
      original: {
        interviewEligible: this.checkEligible(original),
        firstPreference: prefDomains[0] ?? null,
      },
      projected: {
        interviewEligible: reasons.length === 0,
        reasons,
        firstPreference: bestDomain ?? null,
        capacityAvailable,
        recommendationScore: Math.round(
          projected.codingScore * 0.45 + projected.aptitudeScore * 0.25 + projected.cgpa * 3,
        ),
      },
      changedFields: Object.keys(definedOverrides),
      mutatedOfficialRecord: false,
    };
  }

  async anomalies() {
    const students = await this.prisma.student.findMany({
      include: {
        assessmentResults: true,
        preferences: { include: { domain: true } },
      },
    });

    const domains = await this.prisma.domain.findMany();
    const domainNames = new Set(domains.flatMap((d) => [d.code, d.name]));

    const registerNumbers = students.map((s) => s.studentId);
    const emails = students.map((s) => s.email);
    const registerCounts = this.count(registerNumbers);
    const emailCounts = this.count(emails);

    const findings: Array<{ studentId: string; severity: string; type: string; detail: string }> = [];

    for (const student of students) {
      if ((registerCounts[student.studentId] ?? 0) > 1) {
        findings.push({ studentId: student.studentId, severity: 'HIGH', type: 'DUPLICATE_REGISTER_NUMBER', detail: student.studentId });
      }
      if ((emailCounts[student.email] ?? 0) > 1) {
        findings.push({ studentId: student.studentId, severity: 'HIGH', type: 'DUPLICATE_EMAIL', detail: student.email });
      }
      if (student.preferences.length === 0) {
        findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'MISSING_PREFERENCE', detail: 'No domain preference' });
      }

      const certs = this.extractCertificates(student.assessmentResults);
      if (certs.length === 0) {
        findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'MISSING_CERTIFICATE', detail: 'No prerequisite certificate' });
      }

      for (const pref of student.preferences) {
        const prefName = pref.domain?.name ?? pref.domain?.code;
        if (prefName && !domainNames.has(prefName)) {
          findings.push({ studentId: student.studentId, severity: 'MEDIUM', type: 'UNKNOWN_DOMAIN', detail: prefName });
        }
      }
    }

    return findings;
  }

  private extractScores(results: any[]) {
    const score = (key: string) => {
      const r = results.find(
        (r: any) => r.assessmentType === key || r.sourceIdentifier === key,
      );
      return r?.score ?? 0;
    };
    return {
      codingScore: score('CODING') || score('codingScore'),
      aptitudeScore: score('APTITUDE') || score('aptitudeScore'),
      cgpa: score('cgpa'),
      attendancePercent: score('attendancePercent'),
    };
  }

  private extractCertificates(results: any[]): string[] {
    const certRecord = results.find((r: any) => r.sourceIdentifier === 'certificates');
    return (certRecord?.metadata as any)?.certificates ?? [];
  }

  private checkEligible(data: { codingScore: number; attendancePercent: number; completedCertificates: string[]; preferences: string[] }) {
    return data.codingScore >= 70 && data.attendancePercent >= 75 && data.completedCertificates.length > 0 && data.preferences.length > 0;
  }

  private count(values: string[]) {
    return values.reduce<Record<string, number>>((result, value) => {
      if (value) result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {});
  }
}
