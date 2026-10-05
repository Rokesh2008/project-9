import {
  calculateRanking,
  sortStudents,
  computePercentile,
  DefaultTieBreakStrategy,
  type RankingInput,
  type TieBreakStrategy,
} from '../src/member1/ranking/ranking.engine';

describe('RankingEngine', () => {
  // ──────────────────────────────────────────
  // Single student
  // ──────────────────────────────────────────

  describe('single student', () => {
    it('ranks a single student as rank 1', () => {
      const result = calculateRanking(
        [{ studentId: 'stu-1', totalScore: 85 }],
        'wv-1',
      );
      expect(result.rankedStudents).toHaveLength(1);
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[0].studentId).toBe('stu-1');
      expect(result.rankedStudents[0].totalScore).toBe(85);
      expect(result.totalStudents).toBe(1);
    });

    it('single student has tieBreakApplied=false', () => {
      const result = calculateRanking(
        [{ studentId: 'stu-1', totalScore: 85 }],
        'wv-1',
      );
      expect(result.rankedStudents[0].tieBreakApplied).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // Multiple students — descending order
  // ──────────────────────────────────────────

  describe('multiple students', () => {
    it('orders by totalScore descending', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: 70 },
        { studentId: 'stu-2', totalScore: 90 },
        { studentId: 'stu-3', totalScore: 80 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].studentId).toBe('stu-2');
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[1].studentId).toBe('stu-3');
      expect(result.rankedStudents[1].rank).toBe(2);
      expect(result.rankedStudents[2].studentId).toBe('stu-1');
      expect(result.rankedStudents[2].rank).toBe(3);
    });

    it('assigns sequential ranks 1, 2, 3, ...', () => {
      const students: RankingInput[] = [
        { studentId: 'a', totalScore: 100 },
        { studentId: 'b', totalScore: 90 },
        { studentId: 'c', totalScore: 80 },
        { studentId: 'd', totalScore: 70 },
      ];
      const result = calculateRanking(students, 'wv-1');
      const ranks = result.rankedStudents.map((r) => r.rank);
      expect(ranks).toEqual([1, 2, 3, 4]);
    });
  });

  // ──────────────────────────────────────────
  // Tie handling
  // ──────────────────────────────────────────

  describe('tie handling', () => {
    it('resolves equal scores deterministically', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-b', totalScore: 90 },
        { studentId: 'stu-a', totalScore: 90 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].studentId).toBe('stu-a');
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[1].studentId).toBe('stu-b');
      expect(result.rankedStudents[1].rank).toBe(2);
    });

    it('sets tieBreakApplied=true on tied students', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: 90 },
        { studentId: 'stu-2', totalScore: 90 },
        { studentId: 'stu-3', totalScore: 80 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].tieBreakApplied).toBe(true);
      expect(result.rankedStudents[1].tieBreakApplied).toBe(true);
      expect(result.rankedStudents[2].tieBreakApplied).toBe(false);
    });

    it('sets tieBreakApplied=false when no ties', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: 90 },
        { studentId: 'stu-2', totalScore: 80 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].tieBreakApplied).toBe(false);
      expect(result.rankedStudents[1].tieBreakApplied).toBe(false);
    });

    it('reports tiesResolved count', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: 90 },
        { studentId: 'stu-2', totalScore: 90 },
        { studentId: 'stu-3', totalScore: 80 },
      ];
      const result = calculateRanking(students, 'wv-1');
      expect(result.tiesResolved).toBe(2);
    });

    it('handles multiple students with identical scores', () => {
      const students: RankingInput[] = [
        { studentId: 'c', totalScore: 50 },
        { studentId: 'a', totalScore: 50 },
        { studentId: 'b', totalScore: 50 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents.map((r) => r.studentId)).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect(result.rankedStudents.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(result.tiesResolved).toBe(3);
    });
  });

  // ──────────────────────────────────────────
  // Deterministic — same input same output
  // ──────────────────────────────────────────

  describe('determinism', () => {
    it('produces identical ranking for identical input', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-2', totalScore: 85 },
        { studentId: 'stu-1', totalScore: 85 },
        { studentId: 'stu-3', totalScore: 90 },
      ];

      const run1 = calculateRanking(students, 'wv-1');
      const run2 = calculateRanking(students, 'wv-1');

      expect(run1.rankedStudents.map((r) => r.studentId)).toEqual(
        run2.rankedStudents.map((r) => r.studentId),
      );
      expect(run1.rankedStudents.map((r) => r.rank)).toEqual(
        run2.rankedStudents.map((r) => r.rank),
      );
    });

    it('student ID is the final fallback for tie-breaking', () => {
      const students: RankingInput[] = [
        { studentId: 'zzz', totalScore: 50 },
        { studentId: 'aaa', totalScore: 50 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].studentId).toBe('aaa');
      expect(result.rankedStudents[1].studentId).toBe('zzz');
    });
  });

  // ──────────────────────────────────────────
  // Custom tie-break strategy
  // ──────────────────────────────────────────

  describe('custom tie-break strategy', () => {
    it('uses provided strategy instead of default', () => {
      const reverseStrategy: TieBreakStrategy = {
        compare: (a, b) =>
          a.studentId > b.studentId ? -1 : a.studentId < b.studentId ? 1 : 0,
      };

      const students: RankingInput[] = [
        { studentId: 'aaa', totalScore: 50 },
        { studentId: 'zzz', totalScore: 50 },
      ];

      const result = calculateRanking(students, 'wv-1', reverseStrategy);
      expect(result.rankedStudents[0].studentId).toBe('zzz');
      expect(result.rankedStudents[1].studentId).toBe('aaa');
    });
  });

  // ──────────────────────────────────────────
  // Empty population
  // ──────────────────────────────────────────

  describe('empty population', () => {
    it('returns empty result for zero students', () => {
      const result = calculateRanking([], 'wv-1');
      expect(result.rankedStudents).toHaveLength(0);
      expect(result.totalStudents).toBe(0);
      expect(result.tiesResolved).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // Zero / negative scores
  // ──────────────────────────────────────────

  describe('zero and negative scores', () => {
    it('handles zero scores', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: 0 },
        { studentId: 'stu-2', totalScore: 50 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].studentId).toBe('stu-2');
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[1].studentId).toBe('stu-1');
      expect(result.rankedStudents[1].rank).toBe(2);
    });

    it('handles negative scores', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-1', totalScore: -5 },
        { studentId: 'stu-2', totalScore: 10 },
        { studentId: 'stu-3', totalScore: 0 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents.map((r) => r.studentId)).toEqual([
        'stu-2',
        'stu-3',
        'stu-1',
      ]);
    });
  });

  // ──────────────────────────────────────────
  // Zero-score students (no score records)
  // ──────────────────────────────────────────

  describe('zero-score students (missing score records)', () => {
    it('student with totalScore 0 is ranked at the bottom', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-scored', totalScore: 42 },
        { studentId: 'stu-no-records', totalScore: 0, parameterScores: {} },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents).toHaveLength(2);
      expect(result.rankedStudents[0].studentId).toBe('stu-scored');
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[1].studentId).toBe('stu-no-records');
      expect(result.rankedStudents[1].rank).toBe(2);
      expect(result.rankedStudents[1].totalScore).toBe(0);
    });

    it('multiple zero-score students are tie-broken deterministically', () => {
      const students: RankingInput[] = [
        { studentId: 'stu-c', totalScore: 0, parameterScores: {} },
        { studentId: 'stu-a', totalScore: 0, parameterScores: {} },
        { studentId: 'stu-b', totalScore: 0, parameterScores: {} },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents.map((r) => r.studentId)).toEqual([
        'stu-a',
        'stu-b',
        'stu-c',
      ]);
      expect(result.rankedStudents.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(result.tiesResolved).toBe(3);
    });

    it('population of only zero-score students still gets sequential ranks', () => {
      const students: RankingInput[] = [
        { studentId: 'only-one', totalScore: 0, parameterScores: {} },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[0].totalScore).toBe(0);
      expect(result.totalStudents).toBe(1);
    });
  });

  // ──────────────────────────────────────────
  // Ranking does not use eligibility
  // ──────────────────────────────────────────

  describe('eligibility independence', () => {
    it('ineligible student with higher score ranks above eligible student', () => {
      // A eligible score 90, B ineligible score 95
      // Ranking ignores eligibility — B ranks first
      const students: RankingInput[] = [
        { studentId: 'stu-a-eligible', totalScore: 90 },
        { studentId: 'stu-b-ineligible', totalScore: 95 },
      ];
      const result = calculateRanking(students, 'wv-1');

      expect(result.rankedStudents[0].studentId).toBe('stu-b-ineligible');
      expect(result.rankedStudents[0].rank).toBe(1);
      expect(result.rankedStudents[1].studentId).toBe('stu-a-eligible');
      expect(result.rankedStudents[1].rank).toBe(2);
    });
  });

  // ──────────────────────────────────────────
  // WeightVersion preserved
  // ──────────────────────────────────────────

  describe('weight version', () => {
    it('preserves weightVersionId in result', () => {
      const result = calculateRanking(
        [{ studentId: 'stu-1', totalScore: 50 }],
        'wv-42',
      );
      expect(result.weightVersionId).toBe('wv-42');
    });
  });

  // ──────────────────────────────────────────
  // Percentile
  // ──────────────────────────────────────────

  describe('percentile', () => {
    it('computes percentile for rank 1 of 4', () => {
      expect(computePercentile(1, 4)).toBe(75);
    });

    it('computes percentile for rank 4 of 4', () => {
      expect(computePercentile(4, 4)).toBe(0);
    });

    it('returns null for empty population', () => {
      expect(computePercentile(1, 0)).toBeNull();
    });

    it('rank 1 of 100 gives 99 percentile', () => {
      expect(computePercentile(1, 100)).toBe(99);
    });

    it('percentile is included in ranking result', () => {
      const result = calculateRanking(
        [
          { studentId: 'a', totalScore: 90 },
          { studentId: 'b', totalScore: 80 },
        ],
        'wv-1',
      );
      expect(result.rankedStudents[0].percentile).toBe(50);
      expect(result.rankedStudents[1].percentile).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // sortStudents
  // ──────────────────────────────────────────

  describe('sortStudents', () => {
    it('returns tiedPairs set containing only tied student IDs', () => {
      const students: RankingInput[] = [
        { studentId: 'a', totalScore: 90 },
        { studentId: 'b', totalScore: 90 },
        { studentId: 'c', totalScore: 70 },
      ];
      const { sorted, tiedPairs } = sortStudents(students);

      expect(sorted[0].studentId).toBe('a');
      expect(sorted[1].studentId).toBe('b');
      expect(sorted[2].studentId).toBe('c');
      expect(tiedPairs.has('a')).toBe(true);
      expect(tiedPairs.has('b')).toBe(true);
      expect(tiedPairs.has('c')).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // DefaultTieBreakStrategy
  // ──────────────────────────────────────────

  describe('DefaultTieBreakStrategy', () => {
    const strategy = new DefaultTieBreakStrategy();

    it('returns negative when a.studentId < b.studentId', () => {
      expect(
        strategy.compare(
          { studentId: 'aaa', totalScore: 0 },
          { studentId: 'zzz', totalScore: 0 },
        ),
      ).toBeLessThan(0);
    });

    it('returns positive when a.studentId > b.studentId', () => {
      expect(
        strategy.compare(
          { studentId: 'zzz', totalScore: 0 },
          { studentId: 'aaa', totalScore: 0 },
        ),
      ).toBeGreaterThan(0);
    });

    it('returns 0 when studentIds are equal', () => {
      expect(
        strategy.compare(
          { studentId: 'same', totalScore: 0 },
          { studentId: 'same', totalScore: 0 },
        ),
      ).toBe(0);
    });
  });
});
