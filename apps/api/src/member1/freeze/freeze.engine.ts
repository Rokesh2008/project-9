export interface ParameterScoreDetail {
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
  isMissing: boolean;
}

export interface SnapshotStudentInput {
  studentId: string;
  rank: number;
  totalScore: number;
  percentile: number | null;
  parameterScores: Record<string, ParameterScoreDetail>;
  isEligible: boolean;
  eligibilityFailures: string[] | null;
  program: string | null;
  tieBreakApplied: boolean;
}

export interface SnapshotMetadata {
  selectionCycleId: string;
  version: number;
  weightVersionId: string;
  ruleVersionId: string | null;
  hopeCount: number;
  pepCount: number;
  frozenBy: string;
  reason?: string;
}

export interface AssembledSnapshot {
  metadata: SnapshotMetadata;
  entries: SnapshotStudentInput[];
  totalStudents: number;
}

export function validateSnapshotInputs(
  inputs: SnapshotStudentInput[],
): string[] {
  const errors: string[] = [];

  if (inputs.length === 0) {
    return errors;
  }

  const studentIds = new Set<string>();
  const ranks = new Set<number>();

  for (const input of inputs) {
    if (studentIds.has(input.studentId)) {
      errors.push(`Duplicate studentId: ${input.studentId}`);
    }
    studentIds.add(input.studentId);

    if (ranks.has(input.rank)) {
      errors.push(`Duplicate rank: ${input.rank}`);
    }
    ranks.add(input.rank);

    if (input.rank < 1) {
      errors.push(
        `Invalid rank for student ${input.studentId}: ${input.rank}`,
      );
    }
  }

  for (let i = 1; i <= inputs.length; i++) {
    if (!ranks.has(i)) {
      errors.push(`Missing rank ${i} in sequential ranking`);
    }
  }

  return errors;
}

export interface FreezeCountdown {
  status: 'UPCOMING' | 'DUE';
  scheduledAt: Date;
  currentTime: Date;
  remainingMilliseconds: number;
}

export function getFreezeCountdown(
  scheduledAt: Date,
  currentTime: Date = new Date(),
): FreezeCountdown {
  const remaining = scheduledAt.getTime() - currentTime.getTime();
  return {
    status: remaining > 0 ? 'UPCOMING' : 'DUE',
    scheduledAt,
    currentTime,
    remainingMilliseconds: Math.max(0, remaining),
  };
}

export function isFreezeDue(
  status: string,
  scheduledAt: Date,
  currentTime: Date = new Date(),
): boolean {
  if (status === 'CANCELLED' || status === 'EXECUTED' || status === 'POSTPONED') {
    return false;
  }
  if (status !== 'SCHEDULED') return false;
  return currentTime.getTime() >= scheduledAt.getTime();
}

export function assembleSnapshot(
  entries: SnapshotStudentInput[],
  metadata: SnapshotMetadata,
): AssembledSnapshot {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);

  return {
    metadata,
    entries: sorted,
    totalStudents: entries.length,
  };
}
