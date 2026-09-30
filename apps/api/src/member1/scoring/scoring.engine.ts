export interface ParameterScoreInput {
  parameterKey: string;
  rawScore?: number | null;
}

export interface ParameterWeightConfig {
  parameterKey: string;
  weight: number;
  maxRawScore: number;
}

export interface ComputedParameterScore {
  parameterKey: string;
  rawScore: number;
  isMissing: boolean;
  normalizedScore: number;
  weight: number;
  weightedScore: number;
}

export interface ScoreCalculationResult {
  studentId: string;
  selectionCycleId: string;
  weightVersionId: string;
  parameterScores: ComputedParameterScore[];
  totalScore: number;
}

export function normalize(rawScore: number, maxRawScore: number = 100): number {
  if (!Number.isFinite(maxRawScore) || maxRawScore <= 0) {
    throw new Error('maxRawScore must be a positive finite number');
  }
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > maxRawScore) {
    throw new Error(`rawScore ${rawScore} must be between 0 and ${maxRawScore}`);
  }
  return (rawScore / maxRawScore) * 100;
}

export function computeWeightedScore(
  normalizedScore: number,
  weight: number,
): number {
  return normalizedScore * weight;
}

export function resolveParameterScore(
  parameterKey: string,
  input: ParameterScoreInput | undefined,
  weightConfig: ParameterWeightConfig,
): ComputedParameterScore {
  const isMissing =
    !input || input.rawScore === null || input.rawScore === undefined;
  const rawScore = isMissing ? 0 : input!.rawScore!;
  const normalizedScore = normalize(rawScore, weightConfig.maxRawScore);
  const weight = weightConfig.weight;
  const weightedScore = computeWeightedScore(normalizedScore, weight);

  return {
    parameterKey,
    rawScore,
    isMissing,
    normalizedScore,
    weight,
    weightedScore,
  };
}

export function computeTotalScore(
  parameterScores: ComputedParameterScore[],
): number {
  return parameterScores.reduce((sum, ps) => sum + ps.weightedScore, 0);
}

export function validateParameterInputs(
  inputs: ParameterScoreInput[],
): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    if (
      !input.parameterKey ||
      typeof input.parameterKey !== 'string' ||
      input.parameterKey.trim() === ''
    ) {
      errors.push(
        `parameterScores[${i}]: parameterKey must be a non-empty string`,
      );
      continue;
    }

    if (seenKeys.has(input.parameterKey)) {
      errors.push(
        `parameterScores[${i}]: duplicate parameterKey '${input.parameterKey}'`,
      );
      continue;
    }
    seenKeys.add(input.parameterKey);

    if (input.rawScore !== null && input.rawScore !== undefined) {
      if (typeof input.rawScore !== 'number' || !Number.isFinite(input.rawScore)) {
        errors.push(
          `parameterScores[${i}]: rawScore for '${input.parameterKey}' must be a finite number`,
        );
      }
    }
  }

  return errors;
}

export function computeStudentScores(
  studentId: string,
  selectionCycleId: string,
  weightVersionId: string,
  inputs: ParameterScoreInput[],
  weightConfigs: ParameterWeightConfig[],
): ScoreCalculationResult {
  const inputMap = new Map<string, ParameterScoreInput>();
  for (const input of inputs) {
    inputMap.set(input.parameterKey, input);
  }

  const parameterScores = weightConfigs.map((wc) =>
    resolveParameterScore(wc.parameterKey, inputMap.get(wc.parameterKey), wc),
  );

  return {
    studentId,
    selectionCycleId,
    weightVersionId,
    parameterScores,
    totalScore: computeTotalScore(parameterScores),
  };
}
