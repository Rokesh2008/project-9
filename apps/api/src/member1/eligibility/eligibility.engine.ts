// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface EligibilityRule {
  id: string;
  field: string;
  operator: RuleOperator;
  value?: unknown;
}

export type RuleOperator =
  | 'GTE'
  | 'LTE'
  | 'GT'
  | 'LT'
  | 'EQ'
  | 'NEQ'
  | 'EXISTS'
  | 'MIN_COUNT';

export type RuleLogic = 'AND' | 'OR';

export interface RuleConfiguration {
  rules: EligibilityRule[];
  logic: RuleLogic;
}

export interface RuleEvaluationResult {
  ruleId: string;
  field: string;
  operator: RuleOperator;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

export interface EligibilityEvaluationResult {
  isEligible: boolean;
  logic: RuleLogic;
  results: RuleEvaluationResult[];
  failedRules: RuleEvaluationResult[];
}

export type StudentContext = Record<string, unknown>;

// ──────────────────────────────────────────
// Supported operators
// ──────────────────────────────────────────

const SUPPORTED_OPERATORS: ReadonlySet<string> = new Set<RuleOperator>([
  'GTE',
  'LTE',
  'GT',
  'LT',
  'EQ',
  'NEQ',
  'EXISTS',
  'MIN_COUNT',
]);

// ──────────────────────────────────────────
// Configuration validation
// ──────────────────────────────────────────

export function validateRuleConfiguration(
  config: unknown,
): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Rule configuration must be a non-null object');
    return errors;
  }

  const cfg = config as Record<string, unknown>;

  if (!Array.isArray(cfg.rules)) {
    errors.push('rules must be an array');
    return errors;
  }

  if (cfg.rules.length === 0) {
    errors.push('rules array must not be empty');
    return errors;
  }

  if (cfg.logic !== undefined && cfg.logic !== 'AND' && cfg.logic !== 'OR') {
    errors.push(`logic must be "AND" or "OR", got "${cfg.logic}"`);
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < cfg.rules.length; i++) {
    const rule = cfg.rules[i];

    if (!rule || typeof rule !== 'object') {
      errors.push(`rules[${i}]: must be a non-null object`);
      continue;
    }

    const r = rule as Record<string, unknown>;

    if (!r.id || typeof r.id !== 'string') {
      errors.push(`rules[${i}]: id must be a non-empty string`);
    } else if (seenIds.has(r.id)) {
      errors.push(`rules[${i}]: duplicate rule id "${r.id}"`);
    } else {
      seenIds.add(r.id);
    }

    if (!r.field || typeof r.field !== 'string') {
      errors.push(`rules[${i}]: field must be a non-empty string`);
    }

    if (!r.operator || typeof r.operator !== 'string') {
      errors.push(`rules[${i}]: operator must be a non-empty string`);
    } else if (!SUPPORTED_OPERATORS.has(r.operator)) {
      errors.push(
        `rules[${i}]: unsupported operator "${r.operator}"`,
      );
    }

    const op = r.operator as string;
    if (
      op &&
      SUPPORTED_OPERATORS.has(op) &&
      op !== 'EXISTS' &&
      r.value === undefined
    ) {
      errors.push(`rules[${i}]: value is required for operator "${op}"`);
    }
  }

  return errors;
}

// ──────────────────────────────────────────
// Single rule evaluation
// ──────────────────────────────────────────

export function evaluateRule(
  rule: EligibilityRule,
  context: StudentContext,
): RuleEvaluationResult {
  const actualValue = context[rule.field];

  if (rule.operator === 'EXISTS') {
    const exists =
      actualValue !== undefined && actualValue !== null;
    return {
      ruleId: rule.id,
      field: rule.field,
      operator: rule.operator,
      expected: 'exists',
      actual: exists ? actualValue : null,
      passed: exists,
      message: exists
        ? `${rule.field} exists`
        : `${rule.field} is missing or null`,
    };
  }

  if (actualValue === undefined || actualValue === null) {
    return {
      ruleId: rule.id,
      field: rule.field,
      operator: rule.operator,
      expected: rule.value,
      actual: null,
      passed: false,
      message: `${rule.field} is missing — cannot evaluate ${rule.operator}`,
    };
  }

  if (rule.operator === 'MIN_COUNT') {
    const arr = Array.isArray(actualValue) ? actualValue : [];
    const count = arr.length;
    const threshold =
      typeof rule.value === 'number' ? rule.value : Number(rule.value);
    const passed = count >= threshold;
    return {
      ruleId: rule.id,
      field: rule.field,
      operator: rule.operator,
      expected: rule.value,
      actual: count,
      passed,
      message: passed
        ? `${rule.field} count ${count} >= ${threshold}`
        : `${rule.field} count ${count} < ${threshold}`,
    };
  }

  const numActual = typeof actualValue === 'number' ? actualValue : Number(actualValue);

  if (!Number.isFinite(numActual) && !isStringOperator(rule.operator)) {
    return {
      ruleId: rule.id,
      field: rule.field,
      operator: rule.operator,
      expected: rule.value,
      actual: actualValue,
      passed: false,
      message: `${rule.field} value "${actualValue}" is not a valid number`,
    };
  }

  switch (rule.operator) {
    case 'GTE':
      return comparison(rule, numActual, numActual >= Number(rule.value));
    case 'LTE':
      return comparison(rule, numActual, numActual <= Number(rule.value));
    case 'GT':
      return comparison(rule, numActual, numActual > Number(rule.value));
    case 'LT':
      return comparison(rule, numActual, numActual < Number(rule.value));
    case 'EQ':
      return comparison(rule, actualValue, actualValue === rule.value || numActual === Number(rule.value));
    case 'NEQ':
      return comparison(rule, actualValue, actualValue !== rule.value && numActual !== Number(rule.value));
    default:
      return {
        ruleId: rule.id,
        field: rule.field,
        operator: rule.operator,
        expected: rule.value,
        actual: actualValue,
        passed: false,
        message: `Unsupported operator "${rule.operator}"`,
      };
  }
}

function isStringOperator(op: string): boolean {
  return op === 'EQ' || op === 'NEQ';
}

function comparison(
  rule: EligibilityRule,
  actual: unknown,
  passed: boolean,
): RuleEvaluationResult {
  return {
    ruleId: rule.id,
    field: rule.field,
    operator: rule.operator,
    expected: rule.value,
    actual,
    passed,
    message: passed
      ? `${rule.field} ${rule.operator} ${rule.value}: passed`
      : `${rule.field} ${rule.operator} ${rule.value}: failed (actual: ${actual})`,
  };
}

// ──────────────────────────────────────────
// Full evaluation
// ──────────────────────────────────────────

export function evaluateEligibility(
  context: StudentContext,
  config: RuleConfiguration,
): EligibilityEvaluationResult {
  const logic = config.logic ?? 'AND';
  const results = config.rules.map((rule) => evaluateRule(rule, context));
  const failedRules = results.filter((r) => !r.passed);

  let isEligible: boolean;
  if (logic === 'AND') {
    isEligible = failedRules.length === 0;
  } else {
    isEligible = results.some((r) => r.passed);
  }

  return { isEligible, logic, results, failedRules };
}
