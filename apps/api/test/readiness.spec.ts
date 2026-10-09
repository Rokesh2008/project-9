import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { READINESS_PARAMETERS, READINESS_MAX_SCORE } from '../src/readiness/readiness.catalog';
import { ReadinessImportDto, ReadinessRecordDto } from '../src/readiness/readiness.dto';
import { normalizeReadinessRecord, ReadinessService } from '../src/readiness/readiness.service';

const row = (overrides: Partial<ReadinessRecordDto> = {}): ReadinessRecordDto => ({
  registerNumber: 'DEMO2026004', sourceResultId: 'synthetic-result-v1', assessedAt: '2026-10-07T00:00:00Z',
  readinessScore: 5, verificationStatus: 'VERIFIED',
  parameterScores: [{ parameterKey: 'monthly_coding_assessment', rawScore: 5, verificationStatus: 'VERIFIED' }], ...overrides,
});

describe('Readiness and 12 achievement parameters', () => {
  it('defines all 12 modules with a total of 250 marks', () => {
    expect(READINESS_PARAMETERS).toHaveLength(12);
    expect(READINESS_MAX_SCORE).toBe(250);
    expect(new Set(READINESS_PARAMETERS.map(item => item.key)).size).toBe(12);
  });

  it('preserves confirmed zero separately from missing data', () => {
    const result = normalizeReadinessRecord(row({ readinessScore: 0, parameterScores: [
      { parameterKey: 'coding_problems', rawScore: 0, verificationStatus: 'VERIFIED' },
      { parameterKey: 'foreign_language', rawScore: null, verificationStatus: 'NOT_STARTED' },
    ] }));
    expect(result.parameterScores.find(item => item.parameterKey === 'coding_problems')?.rawScore).toBe(0);
    expect(result.parameterScores.find(item => item.parameterKey === 'foreign_language')?.rawScore).toBeNull();
  });

  it.each(['unknown', 'coding'])('rejects unknown/selection-only parameter %s', key => {
    expect(() => normalizeReadinessRecord(row({ parameterScores: [{ parameterKey: key, rawScore: 5, verificationStatus: 'VERIFIED' }] }))).toThrow(BadRequestException);
  });

  it('rejects duplicate module keys', () => {
    const input = row(); input.parameterScores.push(input.parameterScores[0]);
    expect(() => normalizeReadinessRecord(input)).toThrow(BadRequestException);
  });

  it('checks the individual module maximum, not only the global DTO maximum', () => {
    expect(() => normalizeReadinessRecord(row({ parameterScores: [{ parameterKey: 'foreign_language', rawScore: 16, verificationStatus: 'VERIFIED' }] }))).toThrow(BadRequestException);
  });

  it.each([-1, Infinity, NaN, 251])('rejects invalid readiness total %s', readinessScore => {
    expect(() => normalizeReadinessRecord(row({ readinessScore }))).toThrow(BadRequestException);
  });

  it('rejects a verified module without marks', () => {
    expect(() => normalizeReadinessRecord(row({ parameterScores: [{ parameterKey: 'coding_problems', rawScore: null, verificationStatus: 'VERIFIED' }] }))).toThrow(BadRequestException);
  });

  it('rejects marks for a not-started module', () => {
    expect(() => normalizeReadinessRecord(row({ parameterScores: [{ parameterKey: 'coding_problems', rawScore: 0, verificationStatus: 'NOT_STARTED' }] }))).toThrow(BadRequestException);
  });

  it('requires a score for a verified total', () => {
    expect(() => normalizeReadinessRecord(row({ readinessScore: null }))).toThrow(BadRequestException);
  });

  it('checks a complete verified breakdown against the total', () => {
    const parameterScores = READINESS_PARAMETERS.map(parameter => ({ parameterKey: parameter.key, rawScore: parameter.maxScore, verificationStatus: 'VERIFIED' as const }));
    expect(normalizeReadinessRecord(row({ readinessScore: 250, parameterScores })).readinessScore).toBe(250);
    expect(() => normalizeReadinessRecord(row({ readinessScore: 249, parameterScores }))).toThrow(BadRequestException);
  });

  it('validates DTO statuses and permits nullable pending marks', () => {
    const dto = plainToInstance(ReadinessImportDto, { sourceBatchId: 'test', records: [row({ readinessScore: null, verificationStatus: 'PENDING', parameterScores: [{ parameterKey: 'coding_problems', rawScore: null, verificationStatus: 'PENDING' }] })] });
    expect(validateSync(dto)).toHaveLength(0);
    (dto.records[0].parameterScores[0] as any).verificationStatus = 'UNTRUSTED';
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('returns all 12 pending modules for a student without results', async () => {
    const prisma = { readinessAssessment: { findFirst: jest.fn().mockResolvedValue(null) }, assessmentResult: { findFirst: jest.fn().mockResolvedValue(null) } };
    const result = await new ReadinessService(prisma as any).forStudent('internal-id');
    expect(result.score).toBeNull();
    expect(result.parameters).toHaveLength(12);
    expect(result.parameters.every(item => item.rawScore === null && item.verificationStatus === 'PENDING')).toBe(true);
  });

  it('shows an imported legacy total without inventing its module marks', async () => {
    const prisma = { readinessAssessment: { findFirst: jest.fn().mockResolvedValue(null) }, assessmentResult: { findFirst: jest.fn().mockResolvedValue({ score: 0, assessmentDate: new Date() }) } };
    const result = await new ReadinessService(prisma as any).forStudent('internal-id');
    expect(result.score).toBe(0);
    expect(result.source).toBe('PROJECT_2_LEGACY_TOTAL');
    expect(result.parameters.every(item => item.rawScore === null)).toBe(true);
  });

  it('preserves pending/verified module statuses and never fills missing modules with zero', async () => {
    const prisma = { readinessAssessment: { findFirst: jest.fn().mockResolvedValue({ readinessScore: 5, verificationStatus: 'VERIFIED', parameterScores: row().parameterScores, assessedAt: new Date(), sourceResultId: 'test' }) }, assessmentResult: { findFirst: jest.fn().mockResolvedValue(null) } };
    const result = await new ReadinessService(prisma as any).forStudent('internal-id');
    expect(result.score).toBe(5);
    expect(result.parameters.find(item => item.key === 'monthly_coding_assessment')?.rawScore).toBe(5);
    expect(result.parameters.filter(item => item.rawScore === null)).toHaveLength(11);
  });

  it('replays a stored result irrespective of JSON object-key ordering', async () => {
    const input = row();
    const existing = { readinessScore: 5, verificationStatus: 'VERIFIED', assessedAt: new Date(input.assessedAt), parameterScores: [{ rawScore: 5, verificationStatus: 'VERIFIED', parameterKey: 'monthly_coding_assessment' }] };
    const tx = { student: { findUnique: jest.fn().mockResolvedValue({ id: 'internal-id' }) }, readinessAssessment: { findUnique: jest.fn().mockResolvedValue(existing), create: jest.fn() } };
    const service = new ReadinessService({ $transaction: (callback: any) => callback(tx) } as any);
    expect(await service.import({ sourceBatchId: 'test', records: [input] }, 'stable-key')).toMatchObject({ inserted: 0, ignoredDuplicates: 1, updatedRoster: false });
    await expect(service.import({ sourceBatchId: 'test', records: [row({ readinessScore: 6 })] }, 'stable-key')).rejects.toThrow(ConflictException);
    expect(tx.readinessAssessment.create).not.toHaveBeenCalled();
  });
});
