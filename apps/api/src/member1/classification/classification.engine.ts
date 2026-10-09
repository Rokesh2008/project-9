// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export type Program = 'HOPE' | 'PEP' | 'WAITLIST' | 'NOT_ELIGIBLE';

export interface ClassificationInput {
  studentId: string;
  rank: number;
  hopeEligible: boolean;
  pepEligible: boolean;
  customEligibility?: unknown;
}

export interface ClassificationConfig {
  hopeCount: number;
  pepCount: number;
}

export interface ClassifiedStudent {
  studentId: string;
  rank: number;
  program: Program;
  hopeEligible: boolean;
  pepEligible: boolean;
  customEligibility?: unknown;
}

export interface ClassificationCalculationResult {
  classifiedStudents: ClassifiedStudent[];
  totalStudents: number;
  hopeClassified: number;
  pepClassified: number;
  waitlistedCount: number;
  notEligibleCount: number;
}

// ──────────────────────────────────────────
// Validation
// ──────────────────────────────────────────

export function validateClassificationConfig(
  config: ClassificationConfig,
): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.hopeCount) || config.hopeCount < 0) {
    errors.push('hopeCount must be a non-negative integer');
  }
  if (!Number.isInteger(config.pepCount) || config.pepCount < 0) {
    errors.push('pepCount must be a non-negative integer');
  }
  return errors;
}

// ──────────────────────────────────────────
// Classification
// ──────────────────────────────────────────

export function classifyStudents(
  students: ClassificationInput[],
  config: ClassificationConfig,
): ClassificationCalculationResult {
  if (students.length === 0) {
    return {
      classifiedStudents: [],
      totalStudents: 0,
      hopeClassified: 0,
      pepClassified: 0,
      waitlistedCount: 0,
      notEligibleCount: 0,
    };
  }

  const sorted = [...students].sort((a, b) => a.rank - b.rank);

  let hopeSlotsFilled = 0;
  let pepSlotsFilled = 0;

  const classifiedStudents: ClassifiedStudent[] = sorted.map((s) => {
    let program: Program;

    if (!s.hopeEligible && !s.pepEligible) {
      program = 'NOT_ELIGIBLE';
    } else if (s.hopeEligible && hopeSlotsFilled < config.hopeCount) {
      program = 'HOPE';
      hopeSlotsFilled++;
    } else if (s.pepEligible && pepSlotsFilled < config.pepCount) {
      program = 'PEP';
      pepSlotsFilled++;
    } else {
      // Capacity exhaustion does not make an otherwise eligible student ineligible.
      program = 'WAITLIST';
    }

    return {
      studentId: s.studentId,
      rank: s.rank,
      program,
      hopeEligible: s.hopeEligible,
      pepEligible: s.pepEligible,
      ...(s.customEligibility ? {customEligibility:s.customEligibility} : {}),
    };
  });

  const waitlistedCount = classifiedStudents.filter(
    (s) => s.program === 'WAITLIST',
  ).length;
  const notEligibleCount = classifiedStudents.filter(
    (s) => s.program === 'NOT_ELIGIBLE',
  ).length;

  return {
    classifiedStudents,
    totalStudents: students.length,
    hopeClassified: hopeSlotsFilled,
    pepClassified: pepSlotsFilled,
    waitlistedCount,
    notEligibleCount,
  };
}
