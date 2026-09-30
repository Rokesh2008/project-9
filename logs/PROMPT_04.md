# Prompt 04

## Prompt Given
Implement the Member 1 score-processing and weighted-score calculation layer. Receive 12 parameter scores from Project 2, validate, load active WeightVersion, handle missing scores, calculate normalized and weighted scores, persist StudentScore records, return calculated data. Do NOT implement ranking, eligibility, HOPE/PEP classification, or freeze logic.

## Objective
Build the complete scoring pipeline: input validation → active weight loading → missing score handling → normalization (passthrough) → weighted score calculation → idempotent persistence → audit logging → API endpoints. All calculation logic must be pure, deterministic, and independently testable.

## Previous Findings Used
- Architecture doc Section 5.1 (Scoring Pipeline) and Section 6.2 (StudentScore model)
- Prisma schema: StudentScore model with @@unique([studentId, selectionCycleId, weightVersionId, parameterKey])
- CycleConfig.activeWeightVersionId → WeightVersion → ParameterWeight[] chain
- Member 2 contracts (member1.contract.ts) — referenced but not duplicated
- Existing service stubs from Prompt 03 (scoring.service.ts, audit.service.ts, weights.service.ts, cycle.service.ts)
- Jest config (jest.config.cjs) — needed update to find unit test files

## Implementation

### Scoring Engine (Pure Calculation)

**File**: `apps/api/src/member1/scoring/scoring.engine.ts`

Pure functions with zero framework/database dependencies:

| Function | Purpose |
|----------|---------|
| `normalize(rawScore)` | Passthrough: returns rawScore unchanged. Isolated for future normalization strategies. |
| `computeWeightedScore(normalizedScore, weight)` | Returns `normalizedScore × weight` |
| `resolveParameterScore(key, input, config)` | Resolves one parameter: handles missing (rawScore=0, isMissing=true), computes normalized and weighted |
| `computeTotalScore(scores)` | `sum(weightedScore)` across all parameters |
| `validateParameterInputs(inputs)` | Validates: non-empty keys, no duplicates, numeric rawScore (rejects NaN/Infinity) |
| `computeStudentScores(studentId, cycleId, versionId, inputs, configs)` | Orchestrates full per-student calculation, returns ScoreCalculationResult |

**Types exported**: ParameterScoreInput, ParameterWeightConfig, ComputedParameterScore, ScoreCalculationResult

### Scoring Formulas

```
normalizedScore = rawScore                           (passthrough, no formula)
weightedScore   = normalizedScore × weight
totalScore      = Σ(weightedScore for all configured parameters)
```

### Missing-Score Handling

When a parameter is absent from the input or has null/undefined rawScore:
- `rawScore = 0`
- `isMissing = true`
- `normalizedScore = 0`
- `weightedScore = 0`

When a parameter has `rawScore = 0` explicitly:
- `rawScore = 0`
- `isMissing = false`
- `normalizedScore = 0`
- `weightedScore = 0`

These two cases produce the same calculation result but are **distinguishable** via the `isMissing` flag.

### Weight Version Handling

Loading chain: `CycleConfig.activeWeightVersionId` → `WeightVersion` → `ParameterWeight[]`

Validation failures (all throw NestJS exceptions):
- No CycleConfig → NotFoundException
- No activeWeightVersionId set → BadRequestException
- WeightVersion not found → NotFoundException
- WeightVersion has zero parameters → BadRequestException

The scoring engine iterates over **configured** ParameterWeight records (not input parameters). Extra input parameters not in the weight config are silently ignored. Configured parameters missing from input become isMissing=true.

### Idempotency Strategy

Uses Prisma `upsert` on the compound unique key:

```
@@unique([studentId, selectionCycleId, weightVersionId, parameterKey])
```

- First calculation: creates StudentScore records
- Repeated calculation with same WeightVersion: updates existing records (no duplicates)
- Calculation with a different WeightVersion: creates a **separate** set of records (versioned)
- Old weight version scores are preserved (not overwritten by new version calculations)

### Audit Logging

Implemented AuditService.log() → writes to ScoreAuditLog table.

Audit events emitted by the scoring pipeline:
| Event | When |
|-------|------|
| `SCORE_CALCULATION_STARTED` | Before computation begins |
| `SCORE_MISSING_PARAMETER` | For each configured parameter not provided in input (one log per missing) |
| `SCORE_INVALID_INPUT` | When validation rejects the input |
| `SCORE_CALCULATION_FAILURE` | If computation throws unexpectedly |
| `SCORE_CALCULATION_COMPLETED` | After all StudentScore records are persisted (includes totalScore, counts) |

Each audit entry records: selectionCycleId, action, actor, entityType, entityId, metadata.

### Supporting Services Implemented

**WeightsService** (`weights.service.ts`) — Full implementation:
- `createVersion()` — Creates append-only weight version with ParameterWeight records
- `activate()` — Sets activeWeightVersionId on CycleConfig
- `getVersions()` — Lists all versions for a cycle
- `getVersion()` — Gets specific version with parameters
- `getActiveVersion()` — Gets active version with parameters

**CycleService** (`cycle.service.ts`) — Full implementation:
- `createConfig()` — Creates CycleConfig (1:1 with SelectionCycle)
- `updateConfig()` — Updates hopeCount, pepCount, activeWeightVersionId, eligibilityRuleVersionId
- `getConfig()` — Reads CycleConfig

**AuditService** (`audit.service.ts`) — Implemented:
- `log()` — Writes to ScoreAuditLog via Prisma (handles JSON casting for Prisma's InputJsonValue)

### API Endpoints

**ScoringController** (`scoring.controller.ts`) — New file:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/scoring/calculate` | Calculate weighted scores for a student/cycle |
| GET | `/api/scoring/:selectionCycleId/student/:studentId` | Retrieve calculated scores (optional `?weightVersionId=`) |

Both endpoints follow existing conventions: @nestjs/swagger decorators, x-role/x-actor-id headers.

### Test Updates

**Jest config** (`jest.config.cjs`) — Updated:
- Added `<rootDir>/src` to roots (was only `<rootDir>/test`)
- Changed regex from `.*\\.e2e-spec\\.ts$` to `.*\\.(spec|e2e-spec)\\.ts$`

## Files Created
- `apps/api/src/member1/scoring/scoring.engine.ts` — Pure calculation functions and types
- `apps/api/src/member1/scoring/scoring.controller.ts` — REST endpoints for scoring
- `apps/api/test/scoring-engine.spec.ts` — 28 pure unit tests for engine functions
- `apps/api/test/scoring-service.spec.ts` — 19 service tests with mocked Prisma
- `logs/PROMPT_04.md` — This log file

## Files Modified
- `apps/api/src/member1/scoring/scoring.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/scoring/scoring.dto.ts` — Added ParameterScoreInputDto, CalculateStudentScoresDto
- `apps/api/src/member1/audit/audit.service.ts` — Implemented log() with Prisma JSON casting
- `apps/api/src/member1/weights/weights.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/cycle/cycle.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/member1.module.ts` — Registered ScoringController
- `apps/api/jest.config.cjs` — Extended to find *.spec.ts in src/ directory
- `logs/README.md` — Updated log index

## Tests Added

### scoring-engine.spec.ts (28 tests)
| Category | Tests |
|----------|-------|
| normalize | 1 — passthrough identity |
| computeWeightedScore | 4 — basic multiplication, zero score, zero weight, fractional |
| resolveParameterScore | 5 — present input, missing input, null rawScore, undefined rawScore, genuine zero vs missing distinction |
| computeTotalScore | 3 — sum of weighted, empty array, includes missing (0 contribution) |
| validateParameterInputs | 8 — valid inputs, empty key, duplicate key, NaN, Infinity, -Infinity, null allowed, undefined allowed, multiple errors |
| computeStudentScores | 7 — full calculation, missing parameters, extra inputs ignored, total score verification, deterministic output, different weight versions produce different results |

### scoring-service.spec.ts (19 tests)
| Category | Tests |
|----------|-------|
| calculateStudentScores | 10 — valid calculation + persistence, missing params, duplicate key rejection, NaN rejection, Infinity rejection, nonexistent cycle, nonexistent student, upsert idempotency, audit started/completed, audit missing parameter, audit invalid input |
| loadActiveWeights | 5 — successful load, no CycleConfig, no activeWeightVersionId, deleted WeightVersion, empty parameters |
| getStudentScores | 3 — null when empty, returns scores with total, filters by weightVersionId |

## Commands Executed
1. `npm run typecheck -w apps/api` — PASS (zero errors)
2. `DATABASE_URL=... npx prisma validate` — PASS
3. `npx jest --runInBand --testPathPattern="scoring"` — 47/47 PASS
4. `npx jest --runInBand --testPathPattern="(member3|scoring)"` — 55/55 PASS

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| allocation.e2e-spec.ts | 11 | NOT RUN (requires PostgreSQL) |
| **Total runnable** | **55** | **55 PASS** |

## Failures / Blockers
- **PostgreSQL unavailable**: Cannot run allocation.e2e-spec.ts. Pre-existing constraint, not caused by this prompt.
- **No database integration tests for scoring**: Scoring service tests use mocked Prisma. Full integration requires a live database.

## Integration Impact
- **Member 2**: No code changes. WeightsService and CycleService implement supporting infrastructure that Member 2's allocation workflow can reference later.
- **Member 3**: No code changes. Member 3 tests pass (8/8).
- **Prisma Client**: No schema changes in this prompt (models were added in Prompt 03).

## What Was Intentionally NOT Implemented
- Ranking computation (no StudentRanking persistence)
- Rank numbers or tie-breaking
- Eligibility rules or evaluation
- HOPE/PEP classification
- Freeze scheduler or snapshot creation
- Notifications or interview workflow
- Frontend changes
- AI/advisory logic
- Project 2 scoring/evaluation logic (Member 1 receives scores, does not generate them)
- Normalization formula (passthrough only, boundary isolated for future)
- Weight/cycle controller endpoints (service methods implemented, controllers remain stubs)

## Git Changes
Not yet committed. All changes are on branch `feature/member1-eligibility-ranking`.

## Final Status
COMPLETED
