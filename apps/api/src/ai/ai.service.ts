import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface AdvisoryAnalysis {
  studentId: string;
  strengths: string[];
  gaps: string[];
  trend: 'STRONG' | 'STABLE' | 'AT_RISK';
  recommendedDomains: Array<{ domain: string; score: number; reason: string }>;
  generatedAt: string;
  advisoryOnly: true;
}

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async analyze(studentId: string): Promise<AdvisoryAnalysis> {
    const student = await this.prisma.student.findFirst({
      where: { OR: [{ id: studentId }, { studentId }] },
      include: {
        assessmentResults: true,
        preferences: { include: { domain: true }, orderBy: { preferenceRank: 'asc' } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const features = this.extractFeatures(student);

    let analysis: AdvisoryAnalysis;
    try {
      const response = await fetch(`${process.env.AI_SERVICE_URL ?? 'http://localhost:8000'}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(features),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(`AI service returned ${response.status}`);
      const body = await response.json() as Record<string, unknown>;
      analysis = {
        ...body,
        studentId: student.studentId,
        generatedAt: new Date().toISOString(),
        advisoryOnly: true,
      } as AdvisoryAnalysis;
    } catch {
      analysis = this.localAnalysis(student.studentId, features);
    }

    await this.prisma.aiStudentAnalysis.create({
      data: {
        studentId: student.studentId,
        strengths: analysis.strengths as any,
        gaps: analysis.gaps as any,
        trend: analysis.trend,
        recommendedDomains: analysis.recommendedDomains as any,
        modelVersion: 'deterministic-v1',
        advisoryOnly: true,
      },
    });

    return analysis;
  }

  private extractFeatures(student: any) {
    const score = (key: string) => {
      const result = student.assessmentResults?.find(
        (r: any) => r.assessmentType === key || r.sourceIdentifier === key,
      );
      return result?.score ?? 0;
    };
    const dsaMeta = student.assessmentResults?.find(
      (r: any) => r.sourceIdentifier === 'dsaLevel',
    );
    const certMeta = student.assessmentResults?.find(
      (r: any) => r.sourceIdentifier === 'certificates',
    );

    return {
      codingScore: score('CODING') || score('codingScore'),
      aptitudeScore: score('APTITUDE') || score('aptitudeScore'),
      cgpa: score('cgpa') || score('OTHER'),
      attendancePercent: score('attendancePercent'),
      dsaLevel: dsaMeta?.metadata?.level ?? 'BEGINNER',
      preferences: (student.preferences ?? []).map((p: any) => p.domain?.name ?? p.domain?.code ?? p.domainId),
      completedCertificates: certMeta?.metadata?.certificates ?? [],
    };
  }

  private localAnalysis(
    studentId: string,
    features: ReturnType<AiService['extractFeatures']>,
  ): AdvisoryAnalysis {
    const strengths: string[] = [];
    const gaps: string[] = [];
    if (features.codingScore >= 75) strengths.push('Strong coding performance');
    else gaps.push('Improve coding fundamentals');
    if (features.aptitudeScore >= 70) strengths.push('Strong analytical aptitude');
    else gaps.push('Practice quantitative aptitude');
    if (features.cgpa >= 8) strengths.push('Consistent academic performance');
    if (features.attendancePercent < 75) gaps.push('Attendance is below the recommended level');
    if (!features.completedCertificates.length) gaps.push('Complete the selected domain prerequisites');

    const base = features.codingScore * 0.45 + features.aptitudeScore * 0.25 + features.cgpa * 3;
    const domainNames = features.preferences.slice(0, 3);

    const recommendedDomains = domainNames.map((domain: string, index: number) => ({
      domain,
      score: Math.max(50, Math.round(base - index * 4)),
      reason: index === 0
        ? 'Matches the student first preference and current performance profile'
        : 'Alternative preference with available program capacity',
    }));

    const trend: AdvisoryAnalysis['trend'] =
      features.codingScore >= 75 && features.attendancePercent >= 75
        ? 'STRONG'
        : gaps.length >= 2
          ? 'AT_RISK'
          : 'STABLE';

    return {
      studentId,
      strengths,
      gaps,
      trend,
      recommendedDomains,
      generatedAt: new Date().toISOString(),
      advisoryOnly: true,
    };
  }
}
