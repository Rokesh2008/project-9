import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { READINESS_MAX_SCORE, READINESS_PARAMETERS } from './readiness.catalog';
import { ReadinessImportDto, ReadinessRecordDto } from './readiness.dto';

export function normalizeReadinessRecord(row: ReadinessRecordDto) {
  const keys = new Set<string>();
  const parameterScores = row.parameterScores.map(input => {
    const parameter = READINESS_PARAMETERS.find(item => item.key === input.parameterKey);
    if (!parameter || keys.has(input.parameterKey)) throw new BadRequestException('Unknown or duplicate readiness parameter key');
    keys.add(input.parameterKey);
    const rawScore = input.rawScore ?? null;
    if (rawScore !== null && (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > parameter.maxScore)) throw new BadRequestException(`${parameter.key} must be between 0 and ${parameter.maxScore}`);
    if (input.verificationStatus === 'VERIFIED' && rawScore === null) throw new BadRequestException('Verified parameters require a score');
    if (input.verificationStatus === 'NOT_STARTED' && rawScore !== null) throw new BadRequestException('Not-started parameters must not contain a score');
    return { parameterKey: parameter.key, rawScore, verificationStatus: input.verificationStatus };
  }).sort((a, b) => a.parameterKey.localeCompare(b.parameterKey));
  const readinessScore = row.readinessScore ?? null;
  if (row.verificationStatus === 'VERIFIED' && readinessScore === null) throw new BadRequestException('Verified readiness totals require a score');
  if (readinessScore !== null && (!Number.isFinite(readinessScore) || readinessScore < 0 || readinessScore > READINESS_MAX_SCORE)) throw new BadRequestException('Readiness total must be between 0 and 250');
  if (parameterScores.length === 12 && parameterScores.every(item => item.verificationStatus === 'VERIFIED') && readinessScore !== null &&
      Math.abs(parameterScores.reduce((sum, item) => sum + item.rawScore!, 0) - readinessScore) > 0.000001) throw new BadRequestException('Readiness total does not match the 12 verified parameter scores');
  return { readinessScore, parameterScores };
}

@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async import(payload: ReadinessImportDto, idempotencyKey: string) {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    const prepared = payload.records.map(row => ({ row, normalized: normalizeReadinessRecord(row) }));
    const unique = new Set(prepared.map(({ row }) => `${row.registerNumber.trim().toUpperCase()}:${row.sourceResultId}`));
    if (unique.size !== prepared.length) throw new BadRequestException('Duplicate student/result records in batch');
    return this.prisma.$transaction(async tx => {
      let inserted = 0;
      let ignoredDuplicates = 0;
      for (const { row, normalized } of prepared) {
        const student = await tx.student.findUnique({ where: { registerNumber: row.registerNumber.trim().toUpperCase() }, select: { id: true } });
        if (!student) throw new BadRequestException('Register number does not match an existing student');
        const data = {
          studentId: student.id, sourceResultId: row.sourceResultId, sourceBatchId: payload.sourceBatchId,
          readinessScore: normalized.readinessScore, verificationStatus: row.verificationStatus,
          parameterScores: normalized.parameterScores as Prisma.InputJsonValue, assessedAt: new Date(row.assessedAt),
        };
        const existing = await tx.readinessAssessment.findUnique({ where: { studentId_sourceResultId: { studentId: student.id, sourceResultId: row.sourceResultId } } });
        if (existing) {
          const previousParameters = existing.parameterScores as unknown as Array<{ parameterKey: string; rawScore: number | null; verificationStatus: string }>;
          const sameParameters = previousParameters.length === normalized.parameterScores.length && previousParameters.every(previous => normalized.parameterScores.some(item => item.parameterKey === previous.parameterKey && item.rawScore === previous.rawScore && item.verificationStatus === previous.verificationStatus));
          if (existing.readinessScore !== data.readinessScore || existing.verificationStatus !== data.verificationStatus ||
              existing.assessedAt.getTime() !== data.assessedAt.getTime() || !sameParameters) throw new ConflictException('A result ID already exists with different data. Send a new result ID for a corrected revision.');
          ignoredDuplicates++;
        } else {
          await tx.readinessAssessment.create({ data });
          inserted++;
        }
      }
      return { inserted, ignoredDuplicates, updatedRoster: false, recalculatedSelection: false };
    }, { timeout: 30000 });
  }

  async forStudent(studentId: string) {
    const [latest, legacy] = await Promise.all([
      this.prisma.readinessAssessment.findFirst({ where: { studentId }, orderBy: [{ assessedAt: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.assessmentResult.findFirst({ where: { studentId, metadata: { path: ['kind'], equals: 'READINESS_SCORE' } }, orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }] }),
    ]);
    const useLegacy = !latest && legacy;
    const stored = (latest?.parameterScores ?? []) as unknown as Array<{ parameterKey: string; rawScore: number | null; verificationStatus: string }>;
    return {
      score: latest ? latest.readinessScore : useLegacy ? legacy.score : null,
      maxScore: READINESS_MAX_SCORE,
      verificationStatus: latest?.verificationStatus ?? (useLegacy ? 'IMPORTED' : 'PENDING'),
      assessedAt: latest?.assessedAt ?? (useLegacy ? legacy.assessmentDate : null),
      source: latest ? 'PROJECT_2' : useLegacy ? 'PROJECT_2_LEGACY_TOTAL' : null,
      sourceResultId: latest?.sourceResultId ?? null,
      parameters: READINESS_PARAMETERS.map(parameter => {
        const value = stored.find(item => item.parameterKey === parameter.key);
        return { ...parameter, rawScore: value?.rawScore ?? null, verificationStatus: value?.verificationStatus ?? 'PENDING' };
      }),
    };
  }
}
