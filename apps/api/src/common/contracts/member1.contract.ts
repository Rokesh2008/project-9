/**
 * Official contract interface with Member 1 (Decision Engine: Eligibility, Ranking, Capacity, Selection)
 * Member 2 consumes these contracts rather than implementing Member 1 business logic.
 */

export interface SelectionResultContract {
  studentId: string;
  selectionCycleId: string;
  selected: boolean;
  programCode: string;
  rank?: number;
  score?: number;
  decisionReference: string;
  evaluatedAt: Date | string;
  criteriaSummary?: Record<string, any>;
  source?: 'LIVE' | 'SNAPSHOT';
  snapshotId?: string;
  snapshotVersion?: number;
}

export interface EligibilityResultContract {
  studentId: string;
  selectionCycleId: string;
  isEligible: boolean;
  failedRules?: string[];
  evaluatedAt: Date | string;
}

export interface CapacityConfigContract {
  domainCode: string;
  trainingBatchCode: string;
  maxCapacity: number;
  reservedSeats?: number;
}

export interface RankingResultContract {
  studentId: string;
  selectionCycleId: string;
  rank: number;
  percentile?: number;
  calculatedAt: Date | string;
}

export interface ClassificationResultContract {
  studentId: string;
  selectionCycleId: string;
  program: string;
  rank: number;
  status: string;
  classifiedAt: Date | string;
  source?: 'LIVE' | 'SNAPSHOT';
  snapshotId?: string;
  snapshotVersion?: number;
}

export interface SelectionAuthorityContract {
  source: 'LIVE' | 'SNAPSHOT';
  snapshotId?: string;
  snapshotVersion?: number;
}
