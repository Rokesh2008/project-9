import {
  validateSnapshotInputs,
  assembleSnapshot,
  type SnapshotStudentInput,
  type SnapshotMetadata,
  type ParameterScoreDetail,
} from '../src/member1/freeze/freeze.engine';

function makeParameterScore(overrides?: Partial<ParameterScoreDetail>): ParameterScoreDetail {
  return {
    raw: 80,
    normalized: 0.8,
    weight: 0.15,
    weighted: 12,
    isMissing: false,
    ...overrides,
  };
}

function makeEntry(overrides?: Partial<SnapshotStudentInput>): SnapshotStudentInput {
  return {
    studentId: 'student-1',
    rank: 1,
    totalScore: 85,
    percentile: 95,
    parameterScores: { param1: makeParameterScore() },
    isEligible: true,
    eligibilityFailures: null,
    program: 'HOPE',
    tieBreakApplied: false,
    ...overrides,
  };
}

function makeMetadata(overrides?: Partial<SnapshotMetadata>): SnapshotMetadata {
  return {
    selectionCycleId: 'cycle-1',
    version: 1,
    weightVersionId: 'wv-1',
    ruleVersionId: 'rv-1',
    hopeCount: 1,
    pepCount: 0,
    frozenBy: 'admin-1',
    ...overrides,
  };
}

describe('Freeze Engine - validateSnapshotInputs', () => {
  it('should return no errors for valid inputs', () => {
    const inputs = [
      makeEntry({ studentId: 'a', rank: 1 }),
      makeEntry({ studentId: 'b', rank: 2 }),
    ];
    expect(validateSnapshotInputs(inputs)).toEqual([]);
  });

  it('should allow empty input list (zero students)', () => {
    expect(validateSnapshotInputs([])).toEqual([]);
  });

  it('should detect duplicate studentId', () => {
    const inputs = [
      makeEntry({ studentId: 'dup', rank: 1 }),
      makeEntry({ studentId: 'dup', rank: 2 }),
    ];
    const errors = validateSnapshotInputs(inputs);
    expect(errors).toContain('Duplicate studentId: dup');
  });

  it('should detect duplicate rank', () => {
    const inputs = [
      makeEntry({ studentId: 'a', rank: 1 }),
      makeEntry({ studentId: 'b', rank: 1 }),
    ];
    const errors = validateSnapshotInputs(inputs);
    expect(errors).toContain('Duplicate rank: 1');
  });

  it('should detect invalid rank < 1', () => {
    const inputs = [makeEntry({ studentId: 'a', rank: 0 })];
    const errors = validateSnapshotInputs(inputs);
    expect(errors.some((e) => e.includes('Invalid rank'))).toBe(true);
  });

  it('should detect missing rank in sequence', () => {
    const inputs = [
      makeEntry({ studentId: 'a', rank: 1 }),
      makeEntry({ studentId: 'b', rank: 3 }),
    ];
    const errors = validateSnapshotInputs(inputs);
    expect(errors).toContain('Missing rank 2 in sequential ranking');
  });

  it('should preserve parameter score details', () => {
    const entry = makeEntry({
      parameterScores: {
        coding: makeParameterScore({ raw: 90, weighted: 13.5, isMissing: false }),
        aptitude: makeParameterScore({ raw: 0, weighted: 0, isMissing: true }),
      },
    });
    expect(entry.parameterScores.coding.raw).toBe(90);
    expect(entry.parameterScores.coding.weighted).toBe(13.5);
    expect(entry.parameterScores.aptitude.isMissing).toBe(true);
  });

  it('should handle zero-score students', () => {
    const inputs = [
      makeEntry({
        studentId: 'zero',
        rank: 1,
        totalScore: 0,
        parameterScores: {
          p1: makeParameterScore({ raw: 0, weighted: 0 }),
        },
      }),
    ];
    expect(validateSnapshotInputs(inputs)).toEqual([]);
  });

  it('should handle missing-score students', () => {
    const inputs = [
      makeEntry({
        studentId: 'missing',
        rank: 1,
        parameterScores: {
          p1: makeParameterScore({ raw: 0, weighted: 0, isMissing: true }),
        },
      }),
    ];
    expect(validateSnapshotInputs(inputs)).toEqual([]);
  });
});

describe('Freeze Engine - assembleSnapshot', () => {
  it('should sort entries by rank', () => {
    const entries = [
      makeEntry({ studentId: 'c', rank: 3 }),
      makeEntry({ studentId: 'a', rank: 1 }),
      makeEntry({ studentId: 'b', rank: 2 }),
    ];
    const result = assembleSnapshot(entries, makeMetadata());
    expect(result.entries[0].rank).toBe(1);
    expect(result.entries[1].rank).toBe(2);
    expect(result.entries[2].rank).toBe(3);
  });

  it('should set totalStudents correctly', () => {
    const entries = [
      makeEntry({ studentId: 'a', rank: 1 }),
      makeEntry({ studentId: 'b', rank: 2 }),
    ];
    const result = assembleSnapshot(entries, makeMetadata());
    expect(result.totalStudents).toBe(2);
  });

  it('should pass through metadata', () => {
    const meta = makeMetadata({ version: 3, frozenBy: 'admin-x' });
    const result = assembleSnapshot([makeEntry()], meta);
    expect(result.metadata.version).toBe(3);
    expect(result.metadata.frozenBy).toBe('admin-x');
  });

  it('should handle zero students', () => {
    const result = assembleSnapshot([], makeMetadata());
    expect(result.totalStudents).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it('should not mutate original entries array', () => {
    const entries = [
      makeEntry({ studentId: 'b', rank: 2 }),
      makeEntry({ studentId: 'a', rank: 1 }),
    ];
    assembleSnapshot(entries, makeMetadata());
    expect(entries[0].rank).toBe(2);
  });

  it('should preserve raw and weighted scores in assembled output', () => {
    const entries = [
      makeEntry({
        studentId: 'a',
        rank: 1,
        parameterScores: {
          coding: makeParameterScore({ raw: 95, weighted: 14.25, weight: 0.15 }),
        },
      }),
    ];
    const result = assembleSnapshot(entries, makeMetadata());
    const scores = result.entries[0].parameterScores;
    expect(scores.coding.raw).toBe(95);
    expect(scores.coding.weighted).toBe(14.25);
    expect(scores.coding.weight).toBe(0.15);
  });

  it('should preserve eligibility failures', () => {
    const entries = [
      makeEntry({
        studentId: 'a',
        rank: 1,
        isEligible: false,
        eligibilityFailures: ['GPA below threshold', 'Attendance below minimum'],
      }),
    ];
    const result = assembleSnapshot(entries, makeMetadata());
    expect(result.entries[0].eligibilityFailures).toEqual([
      'GPA below threshold',
      'Attendance below minimum',
    ]);
  });

  it('should preserve classification program', () => {
    const entries = [
      makeEntry({ studentId: 'a', rank: 1, program: 'PEP' }),
      makeEntry({ studentId: 'b', rank: 2, program: 'HOPE' }),
      makeEntry({ studentId: 'c', rank: 3, program: 'NOT_ELIGIBLE' }),
    ];
    const result = assembleSnapshot(entries, makeMetadata());
    expect(result.entries[0].program).toBe('PEP');
    expect(result.entries[1].program).toBe('HOPE');
    expect(result.entries[2].program).toBe('NOT_ELIGIBLE');
  });

  it('should preserve weight and rule version in metadata', () => {
    const meta = makeMetadata({
      weightVersionId: 'wv-42',
      ruleVersionId: 'rv-7',
    });
    const result = assembleSnapshot([makeEntry()], meta);
    expect(result.metadata.weightVersionId).toBe('wv-42');
    expect(result.metadata.ruleVersionId).toBe('rv-7');
  });
});
