import {
  classifyStudents,
  validateClassificationConfig,
  type ClassificationInput,
  type ClassificationConfig,
} from '../src/member1/classification/classification.engine';

describe('ClassificationEngine', () => {
  // ──────────────────────────────────────────
  // Basic classification
  // ──────────────────────────────────────────

  describe('basic classification', () => {
    it('classifies HOPE-eligible student inside HOPE boundary as HOPE', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.hopeClassified).toBe(1);
    });

    it('classifies HOPE-eligible student outside HOPE boundary as PEP', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[1].program).toBe('PEP');
    });

    it('classifies PEP-only student as PEP', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: false, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 2, pepCount: 2 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('PEP');
      expect(result.pepClassified).toBe(1);
      expect(result.hopeClassified).toBe(0);
    });

    it('classifies student eligible for neither as NOT_ELIGIBLE', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: false, pepEligible: false },
      ];
      const config: ClassificationConfig = { hopeCount: 2, pepCount: 2 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('NOT_ELIGIBLE');
      expect(result.notEligibleCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────
  // Ranking order
  // ──────────────────────────────────────────

  describe('ranking order', () => {
    it('respects ranking order — higher-ranked eligible gets HOPE', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[0].studentId).toBe('stu-1');
      expect(result.classifiedStudents[1].program).toBe('PEP');
      expect(result.classifiedStudents[1].studentId).toBe('stu-2');
      expect(result.classifiedStudents[2].program).toBe('WAITLIST');
    });

    it('skips ineligible students when filling HOPE slots', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: false, pepEligible: false },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('NOT_ELIGIBLE');
      expect(result.classifiedStudents[1].program).toBe('HOPE');
      expect(result.classifiedStudents[2].program).toBe('PEP');
      expect(result.hopeClassified).toBe(1);
    });

    it('does not change StudentRanking — input ranks are preserved', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: false, pepEligible: false },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].rank).toBe(1);
      expect(result.classifiedStudents[1].rank).toBe(2);
      expect(result.classifiedStudents[2].rank).toBe(3);
    });

    it('sorts input by rank even if provided out of order', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].studentId).toBe('stu-1');
      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[1].studentId).toBe('stu-2');
      expect(result.classifiedStudents[1].program).toBe('PEP');
    });
  });

  // ──────────────────────────────────────────
  // Boundary behavior
  // ──────────────────────────────────────────

  describe('boundary behavior', () => {
    it('more eligible students than HOPE boundary — overflow goes to PEP', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-4', rank: 4, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 2, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[1].program).toBe('HOPE');
      expect(result.classifiedStudents[2].program).toBe('PEP');
      expect(result.classifiedStudents[3].program).toBe('WAITLIST');
      expect(result.hopeClassified).toBe(2);
      expect(result.pepClassified).toBe(1);
      expect(result.waitlistedCount).toBe(1);
    });

    it('eligible students beyond both HOPE and PEP capacities are WAITLISTED', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[2].program).toBe('WAITLIST');
      expect(result.waitlistedCount).toBe(1);
      expect(result.notEligibleCount).toBe(0);
    });

    it('PEP-only student does not consume HOPE slot', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-pep', rank: 1, hopeEligible: false, pepEligible: true },
        { studentId: 'stu-hope', rank: 2, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('PEP');
      expect(result.classifiedStudents[1].program).toBe('HOPE');
      expect(result.hopeClassified).toBe(1);
      expect(result.pepClassified).toBe(1);
    });

    it('tied students at boundary use existing deterministic rank', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 2, pepCount: 2 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[1].program).toBe('HOPE');
      expect(result.classifiedStudents[2].program).toBe('PEP');
    });
  });

  // ──────────────────────────────────────────
  // Recalculation / determinism
  // ──────────────────────────────────────────

  describe('determinism and recalculation', () => {
    it('same input produces identical classification', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: false, pepEligible: false },
      ];
      const config: ClassificationConfig = { hopeCount: 1, pepCount: 1 };

      const run1 = classifyStudents(students, config);
      const run2 = classifyStudents(students, config);

      expect(run1.classifiedStudents.map((s) => s.program)).toEqual(
        run2.classifiedStudents.map((s) => s.program),
      );
    });

    it('changing boundary changes classification', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
      ];

      const result1 = classifyStudents(students, { hopeCount: 1, pepCount: 1 });
      expect(result1.classifiedStudents[1].program).toBe('PEP');

      const result2 = classifyStudents(students, { hopeCount: 2, pepCount: 0 });
      expect(result2.classifiedStudents[1].program).toBe('HOPE');
    });
  });

  // ──────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────

  describe('edge cases', () => {
    it('no students returns empty result', () => {
      const result = classifyStudents([], { hopeCount: 5, pepCount: 5 });

      expect(result.classifiedStudents).toHaveLength(0);
      expect(result.totalStudents).toBe(0);
      expect(result.hopeClassified).toBe(0);
      expect(result.pepClassified).toBe(0);
      expect(result.notEligibleCount).toBe(0);
    });

    it('no eligible students — all NOT_ELIGIBLE', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: false, pepEligible: false },
        { studentId: 'stu-2', rank: 2, hopeEligible: false, pepEligible: false },
      ];
      const result = classifyStudents(students, { hopeCount: 2, pepCount: 2 });

      expect(result.hopeClassified).toBe(0);
      expect(result.pepClassified).toBe(0);
      expect(result.notEligibleCount).toBe(2);
    });

    it('all students HOPE-eligible — fills HOPE then PEP', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-4', rank: 4, hopeEligible: true, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 2, pepCount: 2 });

      expect(result.hopeClassified).toBe(2);
      expect(result.pepClassified).toBe(2);
      expect(result.notEligibleCount).toBe(0);
    });

    it('all students PEP-only', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: false, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: false, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: false, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 2, pepCount: 2 });

      expect(result.hopeClassified).toBe(0);
      expect(result.pepClassified).toBe(2);
      expect(result.classifiedStudents[2].program).toBe('WAITLIST');
      expect(result.waitlistedCount).toBe(1);
    });

    it('hopeCount=0 — no HOPE classifications', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 0, pepCount: 1 });

      expect(result.classifiedStudents[0].program).toBe('PEP');
      expect(result.hopeClassified).toBe(0);
    });

    it('pepCount=0 — no PEP classifications', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 1, pepCount: 0 });

      expect(result.classifiedStudents[0].program).toBe('HOPE');
      expect(result.classifiedStudents[1].program).toBe('WAITLIST');
      expect(result.waitlistedCount).toBe(1);
    });

    it('both counts zero — eligible students are waitlisted', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 0, pepCount: 0 });

      expect(result.classifiedStudents[0].program).toBe('WAITLIST');
      expect(result.waitlistedCount).toBe(1);
      expect(result.notEligibleCount).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // Mixed eligibility
  // ──────────────────────────────────────────

  describe('mixed eligibility population', () => {
    it('correctly interleaves eligible and ineligible students', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: false, pepEligible: false },
        { studentId: 'stu-3', rank: 3, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-4', rank: 4, hopeEligible: false, pepEligible: true },
        { studentId: 'stu-5', rank: 5, hopeEligible: true, pepEligible: true },
      ];
      const config: ClassificationConfig = { hopeCount: 2, pepCount: 2 };
      const result = classifyStudents(students, config);

      expect(result.classifiedStudents[0].program).toBe('HOPE');      // rank 1, hope-eligible
      expect(result.classifiedStudents[1].program).toBe('NOT_ELIGIBLE'); // rank 2, ineligible
      expect(result.classifiedStudents[2].program).toBe('HOPE');      // rank 3, hope-eligible
      expect(result.classifiedStudents[3].program).toBe('PEP');       // rank 4, pep-only
      expect(result.classifiedStudents[4].program).toBe('PEP');       // rank 5, hope+pep, HOPE full → PEP
      expect(result.hopeClassified).toBe(2);
      expect(result.pepClassified).toBe(2);
      expect(result.notEligibleCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────
  // Result metadata
  // ──────────────────────────────────────────

  describe('result metadata', () => {
    it('reports correct counts', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-3', rank: 3, hopeEligible: false, pepEligible: false },
      ];
      const result = classifyStudents(students, { hopeCount: 1, pepCount: 1 });

      expect(result.totalStudents).toBe(3);
      expect(result.hopeClassified).toBe(1);
      expect(result.pepClassified).toBe(1);
      expect(result.notEligibleCount).toBe(1);
    });

    it('preserves eligibility flags in output', () => {
      const students: ClassificationInput[] = [
        { studentId: 'stu-1', rank: 1, hopeEligible: true, pepEligible: true },
        { studentId: 'stu-2', rank: 2, hopeEligible: false, pepEligible: true },
      ];
      const result = classifyStudents(students, { hopeCount: 1, pepCount: 1 });

      expect(result.classifiedStudents[0].hopeEligible).toBe(true);
      expect(result.classifiedStudents[0].pepEligible).toBe(true);
      expect(result.classifiedStudents[1].hopeEligible).toBe(false);
      expect(result.classifiedStudents[1].pepEligible).toBe(true);
    });
  });

  // ──────────────────────────────────────────
  // Config validation
  // ──────────────────────────────────────────

  describe('validateClassificationConfig', () => {
    it('passes for valid config', () => {
      expect(validateClassificationConfig({ hopeCount: 5, pepCount: 10 })).toEqual([]);
    });

    it('passes for zero counts', () => {
      expect(validateClassificationConfig({ hopeCount: 0, pepCount: 0 })).toEqual([]);
    });

    it('fails for negative hopeCount', () => {
      const errors = validateClassificationConfig({ hopeCount: -1, pepCount: 5 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('hopeCount');
    });

    it('fails for negative pepCount', () => {
      const errors = validateClassificationConfig({ hopeCount: 5, pepCount: -1 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('pepCount');
    });

    it('fails for non-integer counts', () => {
      const errors = validateClassificationConfig({ hopeCount: 1.5, pepCount: 2.5 });
      expect(errors.length).toBe(2);
    });
  });
});
