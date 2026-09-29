import {
  evaluateRule,
  evaluateEligibility,
  validateRuleConfiguration,
  type EligibilityRule,
  type RuleConfiguration,
  type StudentContext,
} from '../src/member1/eligibility/eligibility.engine';

describe('EligibilityEngine', () => {
  // ──────────────────────────────────────────
  // validateRuleConfiguration
  // ──────────────────────────────────────────

  describe('validateRuleConfiguration', () => {
    it('returns empty array for valid AND config', () => {
      const config = {
        logic: 'AND',
        rules: [
          { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 },
        ],
      };
      expect(validateRuleConfiguration(config)).toEqual([]);
    });

    it('returns empty array for valid OR config', () => {
      const config = {
        logic: 'OR',
        rules: [
          { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 },
          { id: 'r2', field: 'codingScore', operator: 'GTE', value: 50 },
        ],
      };
      expect(validateRuleConfiguration(config)).toEqual([]);
    });

    it('rejects null config', () => {
      const errors = validateRuleConfiguration(null);
      expect(errors).toContain('Rule configuration must be a non-null object');
    });

    it('rejects config without rules array', () => {
      const errors = validateRuleConfiguration({ logic: 'AND' });
      expect(errors).toContain('rules must be an array');
    });

    it('rejects empty rules array', () => {
      const errors = validateRuleConfiguration({ rules: [] });
      expect(errors).toContain('rules array must not be empty');
    });

    it('rejects invalid logic value', () => {
      const errors = validateRuleConfiguration({
        logic: 'XOR',
        rules: [{ id: 'r1', field: 'x', operator: 'GTE', value: 1 }],
      });
      expect(errors[0]).toContain('logic must be "AND" or "OR"');
    });

    it('rejects rule without id', () => {
      const errors = validateRuleConfiguration({
        rules: [{ field: 'x', operator: 'GTE', value: 1 }],
      });
      expect(errors[0]).toContain('id must be a non-empty string');
    });

    it('rejects duplicate rule ids', () => {
      const errors = validateRuleConfiguration({
        rules: [
          { id: 'r1', field: 'a', operator: 'GTE', value: 1 },
          { id: 'r1', field: 'b', operator: 'GTE', value: 2 },
        ],
      });
      expect(errors[0]).toContain('duplicate rule id "r1"');
    });

    it('rejects unsupported operator', () => {
      const errors = validateRuleConfiguration({
        rules: [{ id: 'r1', field: 'x', operator: 'LIKE' }],
      });
      expect(errors[0]).toContain('unsupported operator "LIKE"');
    });

    it('requires value for non-EXISTS operators', () => {
      const errors = validateRuleConfiguration({
        rules: [{ id: 'r1', field: 'x', operator: 'GTE' }],
      });
      expect(errors[0]).toContain('value is required for operator "GTE"');
    });

    it('does not require value for EXISTS operator', () => {
      const errors = validateRuleConfiguration({
        rules: [{ id: 'r1', field: 'email', operator: 'EXISTS' }],
      });
      expect(errors).toEqual([]);
    });

    it('collects multiple errors', () => {
      const errors = validateRuleConfiguration({
        logic: 'NOPE',
        rules: [
          { id: '', field: 'x', operator: 'GTE', value: 1 },
          { id: 'r2', field: '', operator: 'BOGUS' },
        ],
      });
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — GTE
  // ──────────────────────────────────────────

  describe('evaluateRule — GTE', () => {
    const rule: EligibilityRule = { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 };

    it('passes when actual >= threshold', () => {
      const result = evaluateRule(rule, { cgpa: 7.5 });
      expect(result.passed).toBe(true);
    });

    it('passes when actual == threshold (boundary)', () => {
      const result = evaluateRule(rule, { cgpa: 6.0 });
      expect(result.passed).toBe(true);
    });

    it('fails when actual < threshold', () => {
      const result = evaluateRule(rule, { cgpa: 5.9 });
      expect(result.passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — LTE
  // ──────────────────────────────────────────

  describe('evaluateRule — LTE', () => {
    const rule: EligibilityRule = { id: 'r1', field: 'absences', operator: 'LTE', value: 10 };

    it('passes when actual <= threshold', () => {
      expect(evaluateRule(rule, { absences: 5 }).passed).toBe(true);
    });

    it('fails when actual > threshold', () => {
      expect(evaluateRule(rule, { absences: 11 }).passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — GT / LT
  // ──────────────────────────────────────────

  describe('evaluateRule — GT', () => {
    const rule: EligibilityRule = { id: 'r1', field: 'score', operator: 'GT', value: 50 };

    it('passes when actual > threshold', () => {
      expect(evaluateRule(rule, { score: 51 }).passed).toBe(true);
    });

    it('fails when actual == threshold', () => {
      expect(evaluateRule(rule, { score: 50 }).passed).toBe(false);
    });
  });

  describe('evaluateRule — LT', () => {
    const rule: EligibilityRule = { id: 'r1', field: 'score', operator: 'LT', value: 50 };

    it('passes when actual < threshold', () => {
      expect(evaluateRule(rule, { score: 49 }).passed).toBe(true);
    });

    it('fails when actual == threshold', () => {
      expect(evaluateRule(rule, { score: 50 }).passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — EQ / NEQ
  // ──────────────────────────────────────────

  describe('evaluateRule — EQ', () => {
    it('passes for matching string', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'dsaLevel', operator: 'EQ', value: 'ADVANCED' };
      expect(evaluateRule(rule, { dsaLevel: 'ADVANCED' }).passed).toBe(true);
    });

    it('fails for non-matching string', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'dsaLevel', operator: 'EQ', value: 'ADVANCED' };
      expect(evaluateRule(rule, { dsaLevel: 'BEGINNER' }).passed).toBe(false);
    });

    it('passes for matching number', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'year', operator: 'EQ', value: 3 };
      expect(evaluateRule(rule, { year: 3 }).passed).toBe(true);
    });
  });

  describe('evaluateRule — NEQ', () => {
    it('passes when values differ', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'status', operator: 'NEQ', value: 'SUSPENDED' };
      expect(evaluateRule(rule, { status: 'ACTIVE' }).passed).toBe(true);
    });

    it('fails when values match', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'status', operator: 'NEQ', value: 'SUSPENDED' };
      expect(evaluateRule(rule, { status: 'SUSPENDED' }).passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — EXISTS
  // ──────────────────────────────────────────

  describe('evaluateRule — EXISTS', () => {
    const rule: EligibilityRule = { id: 'r1', field: 'email', operator: 'EXISTS' };

    it('passes when field is present', () => {
      expect(evaluateRule(rule, { email: 'a@b.com' }).passed).toBe(true);
    });

    it('fails when field is undefined', () => {
      expect(evaluateRule(rule, {}).passed).toBe(false);
    });

    it('fails when field is null', () => {
      expect(evaluateRule(rule, { email: null }).passed).toBe(false);
    });

    it('passes when field is empty string (exists)', () => {
      expect(evaluateRule(rule, { email: '' }).passed).toBe(true);
    });

    it('passes when field is 0 (exists)', () => {
      expect(evaluateRule(rule, { email: 0 }).passed).toBe(true);
    });
  });

  // ──────────────────────────────────────────
  // evaluateRule — MIN_COUNT
  // ──────────────────────────────────────────

  describe('evaluateRule — MIN_COUNT', () => {
    const rule: EligibilityRule = {
      id: 'r1',
      field: 'completedCertificates',
      operator: 'MIN_COUNT',
      value: 2,
    };

    it('passes when array meets threshold', () => {
      expect(evaluateRule(rule, { completedCertificates: ['a', 'b', 'c'] }).passed).toBe(true);
    });

    it('passes at exact threshold', () => {
      expect(evaluateRule(rule, { completedCertificates: ['a', 'b'] }).passed).toBe(true);
    });

    it('fails when array is below threshold', () => {
      expect(evaluateRule(rule, { completedCertificates: ['a'] }).passed).toBe(false);
    });

    it('fails when field is not an array', () => {
      expect(evaluateRule(rule, { completedCertificates: 'single' }).passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // Missing field handling
  // ──────────────────────────────────────────

  describe('missing field handling', () => {
    it('fails GTE when field is missing', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 };
      const result = evaluateRule(rule, {});
      expect(result.passed).toBe(false);
      expect(result.actual).toBeNull();
      expect(result.message).toContain('missing');
    });

    it('fails GTE when field is null', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 };
      const result = evaluateRule(rule, { cgpa: null });
      expect(result.passed).toBe(false);
    });

    it('fails MIN_COUNT when field is null', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'certs', operator: 'MIN_COUNT', value: 1 };
      const result = evaluateRule(rule, { certs: null });
      expect(result.passed).toBe(false);
    });

    it('non-numeric value fails numeric comparison', () => {
      const rule: EligibilityRule = { id: 'r1', field: 'score', operator: 'GTE', value: 50 };
      const result = evaluateRule(rule, { score: 'not-a-number' });
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not a valid number');
    });
  });

  // ──────────────────────────────────────────
  // evaluateEligibility — AND logic
  // ──────────────────────────────────────────

  describe('evaluateEligibility — AND logic', () => {
    const config: RuleConfiguration = {
      logic: 'AND',
      rules: [
        { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 },
        { id: 'r2', field: 'codingScore', operator: 'GTE', value: 50 },
      ],
    };

    it('eligible when all rules pass', () => {
      const result = evaluateEligibility({ cgpa: 7.0, codingScore: 80 }, config);
      expect(result.isEligible).toBe(true);
      expect(result.failedRules).toHaveLength(0);
    });

    it('ineligible when one rule fails', () => {
      const result = evaluateEligibility({ cgpa: 5.0, codingScore: 80 }, config);
      expect(result.isEligible).toBe(false);
      expect(result.failedRules).toHaveLength(1);
      expect(result.failedRules[0].ruleId).toBe('r1');
    });

    it('ineligible when all rules fail', () => {
      const result = evaluateEligibility({ cgpa: 4.0, codingScore: 30 }, config);
      expect(result.isEligible).toBe(false);
      expect(result.failedRules).toHaveLength(2);
    });
  });

  // ──────────────────────────────────────────
  // evaluateEligibility — OR logic
  // ──────────────────────────────────────────

  describe('evaluateEligibility — OR logic', () => {
    const config: RuleConfiguration = {
      logic: 'OR',
      rules: [
        { id: 'r1', field: 'cgpa', operator: 'GTE', value: 9.0 },
        { id: 'r2', field: 'codingScore', operator: 'GTE', value: 90 },
      ],
    };

    it('eligible when at least one rule passes', () => {
      const result = evaluateEligibility({ cgpa: 9.5, codingScore: 30 }, config);
      expect(result.isEligible).toBe(true);
    });

    it('eligible when all rules pass', () => {
      const result = evaluateEligibility({ cgpa: 9.5, codingScore: 95 }, config);
      expect(result.isEligible).toBe(true);
    });

    it('ineligible only when ALL rules fail', () => {
      const result = evaluateEligibility({ cgpa: 5.0, codingScore: 30 }, config);
      expect(result.isEligible).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // evaluateEligibility — defaults to AND
  // ──────────────────────────────────────────

  describe('evaluateEligibility — default logic', () => {
    it('defaults to AND when logic not specified', () => {
      const config: RuleConfiguration = {
        logic: 'AND',
        rules: [
          { id: 'r1', field: 'a', operator: 'GTE', value: 5 },
          { id: 'r2', field: 'b', operator: 'GTE', value: 5 },
        ],
      };
      const result = evaluateEligibility({ a: 10, b: 3 }, config);
      expect(result.isEligible).toBe(false);
      expect(result.logic).toBe('AND');
    });
  });

  // ──────────────────────────────────────────
  // Complex multi-rule scenario
  // ──────────────────────────────────────────

  describe('complex multi-rule scenario', () => {
    const config: RuleConfiguration = {
      logic: 'AND',
      rules: [
        { id: 'r1', field: 'cgpa', operator: 'GTE', value: 6.0 },
        { id: 'r2', field: 'codingScore', operator: 'GTE', value: 40 },
        { id: 'r3', field: 'isActive', operator: 'EQ', value: true },
        { id: 'r4', field: 'email', operator: 'EXISTS' },
        { id: 'r5', field: 'completedCertificates', operator: 'MIN_COUNT', value: 1 },
      ],
    };

    it('all pass for fully qualified student', () => {
      const ctx: StudentContext = {
        cgpa: 8.0,
        codingScore: 75,
        isActive: true,
        email: 'student@uni.edu',
        completedCertificates: ['Python', 'JS'],
      };
      const result = evaluateEligibility(ctx, config);
      expect(result.isEligible).toBe(true);
      expect(result.results).toHaveLength(5);
      expect(result.failedRules).toHaveLength(0);
    });

    it('fails multiple rules at once', () => {
      const ctx: StudentContext = {
        cgpa: 4.0,
        codingScore: 20,
        isActive: true,
        email: 'student@uni.edu',
        completedCertificates: [],
      };
      const result = evaluateEligibility(ctx, config);
      expect(result.isEligible).toBe(false);
      expect(result.failedRules.map((r) => r.ruleId).sort()).toEqual(['r1', 'r2', 'r5']);
    });
  });
});
