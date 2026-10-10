import { Injectable, NotFoundException } from '@nestjs/common';
import { AdvisoryAnalysis, CanonicalStudent, DOMAIN_CAPACITIES } from './domain';
import { Store } from './store';

@Injectable()
export class AiService {
  constructor(private readonly store: Store) {}

  async analyze(studentId: string): Promise<AdvisoryAnalysis> {
    const student = this.store.students.get(studentId);
    if (!student) throw new NotFoundException('Student not found');

    let analysis: AdvisoryAnalysis;
    try {
      const serviceUrl = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (process.env.AI_CLOUD_RUN_AUTH === 'true') {
        const token = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(serviceUrl)}`, {
          headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(2000),
        });
        if (!token.ok) throw new Error('Unable to authenticate advisory service');
        headers.authorization = `Bearer ${await token.text()}`;
      }
      const response = await fetch(`${serviceUrl}/analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.safeFeatures(student)),
        signal: AbortSignal.timeout(process.env.AI_CLOUD_RUN_AUTH === 'true' ? 20000 : 2500),
      });
      if (!response.ok) throw new Error(`AI service returned ${response.status}`);
      analysis = { ...(await response.json()) as Omit<AdvisoryAnalysis, 'studentId' | 'generatedAt'>, studentId, generatedAt: new Date().toISOString(), advisoryOnly: true };
    } catch {
      analysis = this.localAnalysis(student);
    }
    this.store.analyses.set(studentId, analysis);
    this.store.persist();
    return analysis;
  }

  private safeFeatures(student: CanonicalStudent) {
    return {
      codingScore: student.codingScore,
      aptitudeScore: student.aptitudeScore,
      cgpa: student.cgpa,
      attendancePercent: student.attendancePercent,
      dsaLevel: student.dsaLevel,
      preferences: student.preferences,
      completedCertificates: student.completedCertificates,
    };
  }

  private localAnalysis(student: CanonicalStudent): AdvisoryAnalysis {
    const strengths: string[] = [];
    const gaps: string[] = [];
    if (student.codingScore >= 75) strengths.push('Strong coding score'); else gaps.push('Improve coding fundamentals');
    if (student.aptitudeScore >= 70) strengths.push('Strong aptitude'); else gaps.push('Practice quantitative aptitude');
    if (student.cgpa >= 8) strengths.push('Consistent academic performance');
    if (student.attendancePercent < 75) gaps.push('Attendance is below the recommended level');
    if (!student.completedCertificates.length) gaps.push('Complete the selected domain prerequisites');
    const domains = (student.preferences.length ? student.preferences : Object.keys(DOMAIN_CAPACITIES).slice(0, 3))
      .slice(0, 3)
      .map((domain, index) => ({
        domain,
        score: Math.max(50, Math.round(student.codingScore * 0.45 + student.aptitudeScore * 0.25 + student.cgpa * 3 - index * 4)),
        reason: index === 0 ? 'Matches the student first preference and current performance profile' : 'Alternative preference with available program capacity',
      }));
    return {
      studentId: student.studentId,
      strengths,
      gaps,
      trend: student.codingScore >= 75 && student.attendancePercent >= 75 ? 'STRONG' : gaps.length >= 2 ? 'AT_RISK' : 'STABLE',
      recommendedDomains: domains,
      generatedAt: new Date().toISOString(),
      advisoryOnly: true,
    };
  }
}
