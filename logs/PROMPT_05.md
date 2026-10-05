# Prompt 05

## Prompt Given
Implement the Member 1 configurable eligibility engine. Configuration-driven rule evaluation, NO hardcoded thresholds. Support operators GTE/LTE/GT/LT/EQ/NEQ/EXISTS/MIN_COUNT, AND/OR logic, missing field handling, versioned rules, idempotent result persistence. Do NOT implement ranking, HOPE/PEP classification, freeze, or snapshots.

## Objective
Build the eligibility pipeline: rule configuration validation → student context assembly → rule evaluation → result persistence → audit logging → API endpoints. All evaluation logic must be pure, deterministic, and configuration-driven — no institutional rules hardcoded.

## Previous Findings Used
- Architecture doc Section 6.2 (EligibilityRuleVersion, EligibilityResult models)
- Prisma schema: EligibilityRuleVersion.rules (Json), EligibilityResult with @@unique([studentId, selectionCycleId])
- CycleConfig.eligibilityRuleVersionId → EligibilityRuleVersion chain
- Student model → AssessmentResult[] for context assembly
- AssessmentType enum (CODING, COMMUNICATION, TECHNICAL, INTERVIEW, APTITUDE, OTHER)
- Member 2 contracts (EligibilityResultContract interface)
- Scoring engine pattern (pure engine + service separation) from Prompt 04
- AuditService.log() with Prisma.InputJsonValue/JsonNull casting from Prompt 04

## Implementation

### Eligibility Engine (Pure Evaluation)

**File**: `apps/api/src/member1/eligibility/eligibility.engine.ts`

Pure functions with zero framework/database dependencies:

| Function | Purpose |
|----------|---------|
| `validateRuleConfiguration(config)` | Validates rule config structure: rules array non-empty, unique ids, supported operators, required values |
| `evaluateRule(rule, context)` | Evaluates a single rule against student context |
| `evaluateEligibility(context, config)` | Evaluates all rules with AND/OR logic, returns isEligible + failedRules |

**Types exported**: EligibilityRule, RuleOperator, RuleLogic, RuleConfiguration, RuleEvaluationResult, EligibilityEvaluationResult, StudentContext

### Supported Operators

| Operator | Behavior | Value Required |
|----------|----------|----------------|
| GTE | actual >= threshold | Yes |
| LTE | actual <= threshold | Yes |
| GT | actual > threshold | Yes |
| LT | actual < threshold | Yes |
| EQ | actual === value (string or numeric) | Yes |
| NEQ | actual !== value (string or numeric) | Yes |
| EXISTS | field is not undefined/null | No |
| MIN_COUNT | array.length >= threshold | Yes |

### AND/OR Logic

- **AND** (default): isEligible = true only if ALL rules pass
- **OR**: isEligible = true if ANY rule passes

### Missing Field Handling

When a field is undefined or null in the student context:
- **EXISTS**: returns `passed: false` (expected — the rule checks for presence)
- **All other operators**: returns `passed: false` with message "field is missing — cannot evaluate OPERATOR"
- Missing fields **never silently pass** — they always cause rule failure

### Student Context Assembly

`assembleStudentContext(studentId)` builds a flat key-value context from:
- Student record: studentId, name, email, isActive, batchId
- AssessmentResult records: mapped to `{assessmentType}Score`, `{assessmentType}MaxScore`, `{assessmentType}Percentage`
- When multiple assessments of the same type exist, the highest score is used

### Rule Version Management

- **createRuleVersion**: Auto-increments version per cycle, validates configuration before storage
- **activateRuleVersion**: Deactivates all other versions for the cycle, sets isActive=true, updates CycleConfig.eligibilityRuleVersionId
- **getRuleVersions**: Lists all versions for a cycle (newest first)
- **getRuleVersion**: Gets a specific version by ID

### Rule Version Resolution

When evaluating, the active rule version is resolved in order:
1. Explicit `ruleVersionId` parameter (if provided)
2. `CycleConfig.eligibilityRuleVersionId` (if set)
3. `EligibilityRuleVersion` with `isActive=true` for the cycle
4. Throws BadRequestException if none found

### Idempotency Strategy

Uses Prisma `upsert` on the compound unique key:

```
@@unique([studentId, selectionCycleId])
```

- First evaluation: creates EligibilityResult record
- Re-evaluation: updates existing record (new ruleVersionId, isEligible, failedRules, evaluatedAt)
- Only ONE result per student per cycle (latest evaluation wins)

### Audit Logging

Audit events emitted by the eligibility pipeline:

| Event | When |
|-------|------|
| `ELIGIBILITY_RULE_VERSION_CREATED` | New rule version created |
| `ELIGIBILITY_RULE_VERSION_ACTIVATED` | Rule version activated for cycle |
| `ELIGIBILITY_EVALUATION_STARTED` | Before evaluation loop begins |
| `ELIGIBILITY_RULE_FAILED` | For each failed rule on each student (one log per failure) |
| `ELIGIBILITY_EVALUATION_FAILED` | If evaluation throws unexpectedly |
| `ELIGIBILITY_EVALUATION_COMPLETED` | After all students evaluated (includes counts) |
| `ELIGIBILITY_INVALID_RULE_CONFIGURATION` | When stored rule config fails validation |

### API Endpoints

**EligibilityController** (`eligibility.controller.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/eligibility/evaluate` | Evaluate eligibility (all students or single student) |
| POST | `/api/eligibility/rules` | Create a new rule version |
| POST | `/api/eligibility/rules/activate` | Activate a rule version |
| GET | `/api/eligibility/rules/:selectionCycleId` | Get all rule versions for a cycle |
| GET | `/api/eligibility/:selectionCycleId` | Get eligibility results for a cycle |
| GET | `/api/eligibility/:selectionCycleId/student/:studentId` | Get eligibility result for a student |

### DTOs

- **EvaluateEligibilityDto**: selectionCycleId, optional ruleVersionId, optional studentId
- **CreateRuleVersionDto**: selectionCycleId, rules[], optional logic, optional description
- **ActivateRuleVersionDto**: selectionCycleId, ruleVersionId
- **EligibilityRuleDto**: id, field, operator, optional value
- **EligibilityResultDto**: studentId, selectionCycleId, isEligible, failedRules, evaluatedAt, ruleVersionId

## Files Created
- `apps/api/src/member1/eligibility/eligibility.engine.ts` — Pure rule evaluation engine (types + functions)
- `apps/api/test/eligibility-engine.spec.ts` — 40 pure engine unit tests
- `apps/api/test/eligibility-service.spec.ts` — 30 service tests with mocked Prisma
- `logs/PROMPT_05.md` — This log file

## Files Modified
- `apps/api/src/member1/eligibility/eligibility.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/eligibility/eligibility.controller.ts` — Full implementation replacing stub
- `apps/api/src/member1/eligibility/eligibility.dto.ts` — Added CreateRuleVersionDto, ActivateRuleVersionDto, EligibilityRuleDto; expanded EligibilityResultDto
- `logs/README.md` — Updated log index

## Tests Added

### eligibility-engine.spec.ts (40 tests)
| Category | Tests |
|----------|-------|
| validateRuleConfiguration | 12 — valid AND, valid OR, null config, missing rules, empty rules, invalid logic, missing id, duplicate ids, unsupported operator, value required for non-EXISTS, EXISTS no value needed, multiple errors |
| evaluateRule — GTE | 3 — passes above, passes at boundary, fails below |
| evaluateRule — LTE | 2 — passes below, fails above |
| evaluateRule — GT | 2 — passes above, fails at boundary |
| evaluateRule — LT | 2 — passes below, fails at boundary |
| evaluateRule — EQ | 3 — string match, string mismatch, number match |
| evaluateRule — NEQ | 2 — passes when different, fails when same |
| evaluateRule — EXISTS | 5 — present value, undefined, null, empty string, zero |
| evaluateRule — MIN_COUNT | 4 — meets threshold, exact threshold, below threshold, non-array |
| missing field handling | 4 — missing undefined, missing null, MIN_COUNT null, non-numeric value |
| evaluateEligibility — AND | 3 — all pass, one fails, all fail |
| evaluateEligibility — OR | 3 — one passes, all pass, all fail |
| evaluateEligibility — default | 1 — defaults to AND |
| complex multi-rule | 2 — fully qualified student, multiple failures |

### eligibility-service.spec.ts (30 tests)
| Category | Tests |
|----------|-------|
| createRuleVersion | 5 — auto-increment version, starts at v1, invalid cycle, invalid config, audit event |
| activateRuleVersion | 3 — activates and deactivates others, invalid version, wrong cycle |
| assembleStudentContext | 3 — assembles from assessments, missing student, picks highest score |
| evaluate (full pipeline) | 7 — evaluates all students, persists via upsert, audit started/completed, rule failed log, nonexistent cycle, no active rules, single student evaluation |
| evaluate (validation) | 1 — logs invalid rule configuration |
| getResult | 2 — null when missing, returns contract-shaped result |
| getResultsByCycle | 1 — returns all results for cycle |

## Commands Executed
1. `DATABASE_URL=... npx prisma validate` — PASS
2. `npx tsc --noEmit -p apps/api/tsconfig.json` — PASS (zero errors)
3. `npx jest --runInBand --testPathPattern="eligibility"` — 70/70 PASS
4. `npx jest --runInBand --testPathPattern="(eligibility|scoring|member3)"` — 125/125 PASS

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| eligibility-engine.spec.ts | 40 | PASS |
| eligibility-service.spec.ts | 30 | PASS |
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| allocation.e2e-spec.ts | 11 | NOT RUN (requires PostgreSQL) |
| **Total runnable** | **125** | **125 PASS** |

## Failures / Blockers
- **PostgreSQL unavailable**: Cannot run allocation.e2e-spec.ts. Pre-existing constraint.
- **No database integration tests for eligibility**: Service tests use mocked Prisma. Full integration requires a live database.

## Integration Impact
- **Member 2**: No code changes. EligibilityService implements EligibilityResultContract from member1.contract.ts.
- **Member 3**: No code changes. Member 3 tests pass (8/8). Member 3's demo eligibility (RuntimeState) is NOT modified per instructions.
- **Prisma Client**: No schema changes in this prompt (models were added in Prompt 03).

## What Was Intentionally NOT Implemented
- Ranking computation (no StudentRanking persistence)
- Rank numbers or tie-breaking
- HOPE/PEP classification
- Freeze scheduler or snapshot creation
- Notifications or interview workflow
- Frontend changes
- AI/advisory logic
- Member 3 demo eligibility modifications
- Normalization within eligibility (evaluation is pass/fail, not scored)

## Design Decisions

### Pure Engine Separation
Following the scoring.engine.ts pattern: `eligibility.engine.ts` contains zero NestJS/Prisma dependencies. All evaluation logic is pure, deterministic, and independently testable. The service layer handles persistence and orchestration.

### No Hardcoded Rules
The engine evaluates whatever rules are in the RuleConfiguration. No parameter names, thresholds, or institutional logic are baked in. Admins configure rules through the API.

### Student Context as Flat Map
`StudentContext = Record<string, unknown>` — a flat key-value map assembled from DB records. Rule fields reference keys in this map. This keeps the engine decoupled from specific data models.

### Highest Score Wins for Multiple Assessments
When a student has multiple AssessmentResult records of the same type (e.g., two CODING assessments), the highest score is used in the context. This is conservative — ensures the student's best performance is evaluated.

### EligibilityResultContract Compliance
The service returns data conforming to Member 2's EligibilityResultContract interface: studentId, selectionCycleId, isEligible, failedRules (string[]), evaluatedAt. The failedRules field maps rule message strings, not the full rule evaluation objects.

## Git Changes
Not yet committed. All changes are on branch `feature/member1-eligibility-ranking`.

## Final Status
COMPLETED
