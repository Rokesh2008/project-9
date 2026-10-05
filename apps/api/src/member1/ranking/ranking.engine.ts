// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface RankingInput {
  studentId: string;
  totalScore: number;
  parameterScores?: Record<string, number>;
}

export interface RankedStudent {
  studentId: string;
  totalScore: number;
  rank: number;
  percentile: number | null;
  tieBreakApplied: boolean;
}

export interface RankingCalculationResult {
  rankedStudents: RankedStudent[];
  totalStudents: number;
  tiesResolved: number;
  weightVersionId: string;
}

// ──────────────────────────────────────────
// Tie-break strategy interface
// ──────────────────────────────────────────

export interface TieBreakStrategy {
  compare(a: RankingInput, b: RankingInput): number;
}

// The default tie-break strategy uses studentId as a deterministic fallback.
// The institutional tie-break hierarchy remains configurable/open.
// Additional criteria (e.g., secondary parameter scores) can be injected
// by providing a custom TieBreakStrategy implementation.
export class DefaultTieBreakStrategy implements TieBreakStrategy {
  compare(a: RankingInput, b: RankingInput): number {
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  }
}

// ──────────────────────────────────────────
// Sorting
// ──────────────────────────────────────────

export function sortStudents(
  students: RankingInput[],
  strategy: TieBreakStrategy = new DefaultTieBreakStrategy(),
): { sorted: RankingInput[]; tiedPairs: Set<string> } {
  const tiedPairs = new Set<string>();
  const sorted = [...students];

  sorted.sort((a, b) => {
    const scoreDiff = b.totalScore - a.totalScore;
    if (scoreDiff !== 0) return scoreDiff;

    tiedPairs.add(a.studentId);
    tiedPairs.add(b.studentId);
    return strategy.compare(a, b);
  });

  return { sorted, tiedPairs };
}

// ──────────────────────────────────────────
// Percentile calculation
// ──────────────────────────────────────────

// Formula: ((totalStudents - rank) / totalStudents) × 100
// Rank 1 of 100 → 99.0 percentile
// Rank 100 of 100 → 0.0 percentile
export function computePercentile(
  rank: number,
  totalStudents: number,
): number | null {
  if (totalStudents === 0) return null;
  return ((totalStudents - rank) / totalStudents) * 100;
}

// ──────────────────────────────────────────
// Main ranking calculation
// ──────────────────────────────────────────

export function calculateRanking(
  students: RankingInput[],
  weightVersionId: string,
  strategy: TieBreakStrategy = new DefaultTieBreakStrategy(),
): RankingCalculationResult {
  if (students.length === 0) {
    return {
      rankedStudents: [],
      totalStudents: 0,
      tiesResolved: 0,
      weightVersionId,
    };
  }

  const { sorted, tiedPairs } = sortStudents(students, strategy);
  const totalStudents = sorted.length;

  const rankedStudents: RankedStudent[] = sorted.map((s, index) => ({
    studentId: s.studentId,
    totalScore: s.totalScore,
    rank: index + 1,
    percentile: computePercentile(index + 1, totalStudents),
    tieBreakApplied: tiedPairs.has(s.studentId),
  }));

  const tiesResolved = tiedPairs.size;

  return {
    rankedStudents,
    totalStudents,
    tiesResolved,
    weightVersionId,
  };
}
