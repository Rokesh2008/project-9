import {
  normalize,
  computeWeightedScore,
  resolveParameterScore,
  computeTotalScore,
  computeStudentScores,
  validateParameterInputs,
  type ParameterScoreInput,
  type ParameterWeightConfig,
  type ComputedParameterScore,
} from '../src/member1/scoring/scoring.engine';

describe('Scoring Engine — pure calculation functions', () => {
  const WEIGHT_CONFIGS: ParameterWeightConfig[] = [
    { parameterKey: 'coding', weight: 0.5, maxRawScore: 100 },
    { parameterKey: 'aptitude', weight: 0.3, maxRawScore: 100 },
    { parameterKey: 'cgpa', weight: 0.2, maxRawScore: 10 },
  ];

  describe('normalize', () => {
    it('passes through the raw score unchanged', () => {
      expect(normalize(80)).toBe(80);
      expect(normalize(0)).toBe(0);
      expect(normalize(100)).toBe(100);
      expect(normalize(3.14)).toBe(3.14);
    });
  });

  describe('computeWeightedScore', () => {
    it('multiplies normalized score by weight', () => {
      expect(computeWeightedScore(80, 0.5)).toBe(40);
    });

    it('returns 0 when normalized score is 0', () => {
      expect(computeWeightedScore(0, 0.5)).toBe(0);
    });

    it('returns 0 when weight is 0', () => {
      expect(computeWeightedScore(80, 0)).toBe(0);
    });

    it('handles fractional values', () => {
      expect(computeWeightedScore(75, 0.3)).toBeCloseTo(22.5);
    });
  });

  describe('resolveParameterScore', () => {
    const config: ParameterWeightConfig = {
      parameterKey: 'coding',
      weight: 0.5,
      maxRawScore: 100,
    };

    it('calculates score for a present input', () => {
      const input: ParameterScoreInput = {
        parameterKey: 'coding',
        rawScore: 80,
      };
      const result = resolveParameterScore('coding', input, config);

      expect(result.parameterKey).toBe('coding');
      expect(result.rawScore).toBe(80);
      expect(result.isMissing).toBe(false);
      expect(result.normalizedScore).toBe(80);
      expect(result.weight).toBe(0.5);
      expect(result.weightedScore).toBe(40);
    });

    it('treats missing input as rawScore=0 with isMissing=true', () => {
      const result = resolveParameterScore('coding', undefined, config);

      expect(result.rawScore).toBe(0);
      expect(result.isMissing).toBe(true);
      expect(result.normalizedScore).toBe(0);
      expect(result.weightedScore).toBe(0);
    });

    it('treats null rawScore as missing', () => {
      const input: ParameterScoreInput = {
        parameterKey: 'coding',
        rawScore: null,
      };
      const result = resolveParameterScore('coding', input, config);

      expect(result.rawScore).toBe(0);
      expect(result.isMissing).toBe(true);
      expect(result.weightedScore).toBe(0);
    });

    it('treats undefined rawScore as missing', () => {
      const input: ParameterScoreInput = {
        parameterKey: 'coding',
        rawScore: undefined,
      };
      const result = resolveParameterScore('coding', input, config);

      expect(result.rawScore).toBe(0);
      expect(result.isMissing).toBe(true);
    });

    it('distinguishes genuine zero from missing', () => {
      const genuineZero: ParameterScoreInput = {
        parameterKey: 'coding',
        rawScore: 0,
      };
      const missing: ParameterScoreInput = {
        parameterKey: 'coding',
        rawScore: null,
      };

      const genuineResult = resolveParameterScore(
        'coding',
        genuineZero,
        config,
      );
      const missingResult = resolveParameterScore(
        'coding',
        missing,
        config,
      );

      expect(genuineResult.rawScore).toBe(0);
      expect(genuineResult.isMissing).toBe(false);
      expect(missingResult.rawScore).toBe(0);
      expect(missingResult.isMissing).toBe(true);

      expect(genuineResult.weightedScore).toBe(0);
      expect(missingResult.weightedScore).toBe(0);
    });
  });

  describe('computeTotalScore', () => {
    it('sums all weighted scores', () => {
      const scores: ComputedParameterScore[] = [
        {
          parameterKey: 'coding',
          rawScore: 80,
          isMissing: false,
          normalizedScore: 80,
          weight: 0.5,
          weightedScore: 40,
        },
        {
          parameterKey: 'aptitude',
          rawScore: 70,
          isMissing: false,
          normalizedScore: 70,
          weight: 0.3,
          weightedScore: 21,
        },
        {
          parameterKey: 'cgpa',
          rawScore: 8.5,
          isMissing: false,
          normalizedScore: 8.5,
          weight: 0.2,
          weightedScore: 1.7,
        },
      ];

      expect(computeTotalScore(scores)).toBeCloseTo(62.7);
    });

    it('returns 0 for empty array', () => {
      expect(computeTotalScore([])).toBe(0);
    });

    it('includes missing parameter scores (which are 0)', () => {
      const scores: ComputedParameterScore[] = [
        {
          parameterKey: 'coding',
          rawScore: 80,
          isMissing: false,
          normalizedScore: 80,
          weight: 0.5,
          weightedScore: 40,
        },
        {
          parameterKey: 'aptitude',
          rawScore: 0,
          isMissing: true,
          normalizedScore: 0,
          weight: 0.3,
          weightedScore: 0,
        },
      ];

      expect(computeTotalScore(scores)).toBe(40);
    });
  });

  describe('validateParameterInputs', () => {
    it('returns no errors for valid inputs', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'aptitude', rawScore: 70 },
      ];

      expect(validateParameterInputs(inputs)).toEqual([]);
    });

    it('rejects empty parameterKey', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: '', rawScore: 80 },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('non-empty string');
    });

    it('rejects duplicate parameterKey', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'coding', rawScore: 90 },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('duplicate');
    });

    it('rejects NaN rawScore', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: NaN },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('finite number');
    });

    it('rejects Infinity rawScore', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: Infinity },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('finite number');
    });

    it('rejects negative Infinity rawScore', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: -Infinity },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(1);
    });

    it('allows null rawScore (missing)', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: null },
      ];

      expect(validateParameterInputs(inputs)).toEqual([]);
    });

    it('allows undefined rawScore (missing)', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding' },
      ];

      expect(validateParameterInputs(inputs)).toEqual([]);
    });

    it('collects multiple errors', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: '', rawScore: 80 },
        { parameterKey: 'coding', rawScore: NaN },
        { parameterKey: 'coding', rawScore: 90 },
      ];

      const errors = validateParameterInputs(inputs);
      expect(errors.length).toBe(3);
    });
  });

  describe('computeStudentScores', () => {
    it('computes scores for all configured parameters', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'aptitude', rawScore: 70 },
        { parameterKey: 'cgpa', rawScore: 8.5 },
      ];

      const result = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );

      expect(result.studentId).toBe('student-1');
      expect(result.selectionCycleId).toBe('cycle-1');
      expect(result.weightVersionId).toBe('wv-1');
      expect(result.parameterScores).toHaveLength(3);

      const coding = result.parameterScores.find(
        (p) => p.parameterKey === 'coding',
      )!;
      expect(coding.rawScore).toBe(80);
      expect(coding.isMissing).toBe(false);
      expect(coding.weightedScore).toBe(40);

      const aptitude = result.parameterScores.find(
        (p) => p.parameterKey === 'aptitude',
      )!;
      expect(aptitude.weightedScore).toBeCloseTo(21);

      const cgpa = result.parameterScores.find(
        (p) => p.parameterKey === 'cgpa',
      )!;
      expect(cgpa.weightedScore).toBeCloseTo(1.7);

      expect(result.totalScore).toBeCloseTo(62.7);
    });

    it('handles missing parameters with isMissing=true and rawScore=0', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
      ];

      const result = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );

      expect(result.parameterScores).toHaveLength(3);

      const aptitude = result.parameterScores.find(
        (p) => p.parameterKey === 'aptitude',
      )!;
      expect(aptitude.rawScore).toBe(0);
      expect(aptitude.isMissing).toBe(true);
      expect(aptitude.weightedScore).toBe(0);

      const cgpa = result.parameterScores.find(
        (p) => p.parameterKey === 'cgpa',
      )!;
      expect(cgpa.isMissing).toBe(true);

      expect(result.totalScore).toBe(40);
    });

    it('ignores extra input parameters not in weight config', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'aptitude', rawScore: 70 },
        { parameterKey: 'cgpa', rawScore: 8.5 },
        { parameterKey: 'extra_param', rawScore: 99 },
      ];

      const result = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );

      expect(result.parameterScores).toHaveLength(3);
      expect(
        result.parameterScores.find(
          (p) => p.parameterKey === 'extra_param',
        ),
      ).toBeUndefined();
    });

    it('total score is the sum of all weighted scores', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 100 },
        { parameterKey: 'aptitude', rawScore: 100 },
        { parameterKey: 'cgpa', rawScore: 10 },
      ];

      const result = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );

      const manualTotal =
        100 * 0.5 + 100 * 0.3 + 10 * 0.2;
      expect(result.totalScore).toBeCloseTo(manualTotal);
    });

    it('produces deterministic output for same inputs', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'aptitude', rawScore: 70 },
        { parameterKey: 'cgpa', rawScore: 8.5 },
      ];

      const result1 = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );
      const result2 = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );

      expect(result1.totalScore).toBe(result2.totalScore);
      expect(result1.parameterScores).toEqual(result2.parameterScores);
    });

    it('different weight versions produce different results', () => {
      const inputs: ParameterScoreInput[] = [
        { parameterKey: 'coding', rawScore: 80 },
        { parameterKey: 'aptitude', rawScore: 70 },
        { parameterKey: 'cgpa', rawScore: 8.5 },
      ];

      const altWeights: ParameterWeightConfig[] = [
        { parameterKey: 'coding', weight: 0.3, maxRawScore: 100 },
        { parameterKey: 'aptitude', weight: 0.5, maxRawScore: 100 },
        { parameterKey: 'cgpa', weight: 0.2, maxRawScore: 10 },
      ];

      const result1 = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-1',
        inputs,
        WEIGHT_CONFIGS,
      );
      const result2 = computeStudentScores(
        'student-1',
        'cycle-1',
        'wv-2',
        inputs,
        altWeights,
      );

      expect(result1.totalScore).not.toBe(result2.totalScore);
      expect(result1.weightVersionId).toBe('wv-1');
      expect(result2.weightVersionId).toBe('wv-2');
    });
  });
});
