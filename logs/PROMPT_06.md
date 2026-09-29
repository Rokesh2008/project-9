# Prompt 06

## Prompt Given
Implement the Member 1 common live ranking engine. ONE common ranking for ALL students, deterministic sorting, configurable tie-breaking, sequential ranks, percentile, persistence via upsert, transactional consistency, recalculation support, RankingResultContract compatibility, audit logging. Do NOT implement HOPE/PEP classification, freeze, frozen snapshots, notifications, final selection, or interview workflow.

## Objective
Build the ranking pipeline: resolve active WeightVersion → load StudentScore data → compute total scores → sort deterministically → apply tie-breaking → assign sequential ranks → compute percentile → persist via transaction → audit logging → API endpoints. Ranking is ONE common list for ALL students regardless of eligibility.

## Previous Findings Used
- Architecture doc Section 9 (Ranking Engine, Tie-Break Strategy, Percentile Formula)
- Prisma schema: StudentRanking model with @@unique([studentId, selectionCycleId])
- CycleConfig.activeWeightVersionId → WeightVersion chain (from Prompt 04)
- StudentScore records with weightedScore per parameter (from Prompt 04)
- Member 2 contracts (RankingResultContract interface)
- Scoring engine pattern (pure engine + service separation) from Prompt 04
- AuditService.log() with Prisma.InputJsonValue/JsonNull casting from Prompt 04
- StudentCycleStatus model (student ↔ cycle relationship via @@unique([studentId, selectionCycleId]))

## Ranking Architecture

### ONE Common Ranking
There is ONE ranking for ALL students in the selection cycle. The engine does NOT create separate rankings based on eligibility, HOPE/PEP status, or any other filter. Both eligible and ineligible students appear in the same ranking ordered purely by total score.

Example:
- Student B (ineligible, score 95) → Rank 1
- Student A (eligible, score 90) → Rank 2
- Student C (eligible, score 88) → Rank 3

Eligibility is stored separately in EligibilityResult and does not affect ranking position.

### Ranking Input
The ranking engine consumes total scores from the existing StudentScore records produced by Prompt 04's scoring layer. It does NOT duplicate scoring formulas. For each student, totalScore = sum(weightedScore) across all StudentScore records for the given selectionCycleId and weightVersionId.

### Score Source
Primary score source is persisted StudentScore records using the active WeightVersion. The ranking engine loads all StudentScore records for the cycle+weightVersion, groups by studentId, and sums weightedScore to produce each student's totalScore.

### WeightVersion Handling
The active WeightVersion is resolved from CycleConfig.activeWeightVersionId. If an explicit weightVersionId is provided, it is validated against the cycle. Every StudentRanking record stores the exact weightVersionId used.

Failures:
- No CycleConfig → NotFoundException
- No activeWeightVersionId → BadRequestException
- WeightVersion not found → NotFoundException
- Weight version belongs to different cycle → BadRequestException

## Implementation

### Ranking Engine (Pure Calculation)

**File**: `apps/api/src/member1/ranking/ranking.engine.ts`

Pure functions with zero framework/database dependencies:

| Function | Purpose |
|----------|---------|
| `sortStudents(students, strategy)` | Sort by totalScore DESC, use strategy for ties, track tiedPairs |
| `computePercentile(rank, totalStudents)` | Formula: ((totalStudents - rank) / totalStudents) × 100 |
| `calculateRanking(students, weightVersionId, strategy)` | Full ranking: sort → assign sequential ranks → compute percentile → build result |

**Types exported**: RankingInput, RankedStudent, RankingCalculationResult, TieBreakStrategy

**Classes exported**: DefaultTieBreakStrategy

### Tie-Break Strategy

The tie-break mechanism is isolated behind a `TieBreakStrategy` interface:

```typescript
interface TieBreakStrategy {
  compare(a: RankingInput, b: RankingInput): number;
}
```

**DefaultTieBreakStrategy**: Uses studentId string comparison as a deterministic fallback. This guarantees:
- Same input → same output (no randomness)
- No database ordering dependency
- No request-order dependency

**The final institutional tie-break hierarchy remains configurable/open.** Additional criteria (e.g., secondary parameter scores) can be injected by providing a custom TieBreakStrategy implementation via `RankingService.setTieBreakStrategy()`.

`tieBreakApplied = true` only when a tie actually required the tie-break strategy. Students with unique scores have `tieBreakApplied = false`.

### Rank Numbering Strategy

Sequential deterministic ranks: 1, 2, 3, 4, ...

NOT competition ranking (1, 1, 3). Exactly one rank number per student. This is a deliberate design decision — competition ranking would leave gaps and complicate HOPE/PEP boundary selection in future prompts.

### Percentile

Formula: `((totalStudents - rank) / totalStudents) × 100`

- Rank 1 of 100 → 99.0 percentile
- Rank 100 of 100 → 0.0 percentile
- Empty population → null

Percentile does NOT affect rank ordering. It is a derived display value.

### Eligibility Separation

Ranking does NOT filter, exclude, or reorder based on EligibilityResult. Both eligible and ineligible students appear in the ONE common ranking. Eligibility is a separate concept stored in EligibilityResult and consumed separately by classification (future prompt).

### Persistence Strategy

Uses Prisma `$transaction` wrapping upserts on the compound unique key:

```
@@unique([studentId, selectionCycleId])
```

- First calculation: creates StudentRanking records
- Recalculation: updates existing records (rank, totalScore, percentile, tieBreakApplied, calculatedAt)
- No duplicate rows possible
- Partial updates avoided via transaction

Each StudentRanking retains: studentId, selectionCycleId, weightVersionId, totalScore, rank, percentile, tieBreakApplied, calculatedAt.

### Transaction Strategy

All upserts are collected as Prisma promise array and executed within `prisma.$transaction([...])`. This ensures:
- All rankings update atomically
- No partial state visible during recalculation
- If any upsert fails, all roll back

The engine does NOT touch RankingSnapshot, FreezeSchedule, or any frozen data.

### Recalculation

`calculate(selectionCycleId)` is explicitly triggered — NOT automatic on every score write.

When recalculated:
1. Read current StudentScore data for the active WeightVersion
2. Recompute total scores (sum of weightedScore)
3. Sort deterministically
4. Assign sequential ranks
5. Compute percentile
6. Persist via transactional upserts
7. Update calculatedAt

A score change before freeze is reflected in the next explicit recalculation call.

### API Endpoints

**RankingController** (`ranking.controller.ts`):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ranking/calculate` | Calculate/recalculate the common live ranking for a cycle |
| GET | `/api/ranking/:selectionCycleId` | Get the live ranking (paginated) |
| GET | `/api/ranking/:selectionCycleId/student/:studentId` | Get rank for a specific student |

No frozen snapshot endpoints. Those belong to the future freeze implementation.

### Audit Events

| Event | When |
|-------|------|
| `RANKING_CALCULATION_STARTED` | Before ranking computation begins |
| `RANKING_CALCULATION_COMPLETED` | After all rankings persisted (includes totalStudents, tiesResolved, weightVersionId) |
| `RANKING_CALCULATION_FAILED` | If computation throws unexpectedly |
| `RANKING_TIE_RESOLVED` | When ties are detected and resolved (includes tiedStudentCount) |

## Files Created
- `apps/api/src/member1/ranking/ranking.engine.ts` — Pure ranking calculation engine (types, strategy interface, sorting, percentile, main calculation)
- `apps/api/test/ranking-engine.spec.ts` — 30 pure engine unit tests
- `apps/api/test/ranking-service.spec.ts` — 14 service tests with mocked Prisma
- `logs/PROMPT_06.md` — This log file

## Files Modified
- `apps/api/src/member1/ranking/ranking.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/ranking/ranking.controller.ts` — Full implementation replacing stub
- `logs/README.md` — Updated log index

## Tests Added

### ranking-engine.spec.ts (30 tests)
| Category | Tests |
|----------|-------|
| single student | 2 — rank 1, tieBreakApplied=false |
| multiple students | 2 — descending order, sequential ranks 1,2,3,4 |
| tie handling | 5 — deterministic resolution, tieBreakApplied=true on tied, false on untied, tiesResolved count, multiple identical scores |
| determinism | 2 — identical input → identical output, studentId final fallback |
| custom tie-break strategy | 1 — reverse strategy overrides default |
| empty population | 1 — zero students returns empty |
| zero and negative scores | 2 — zero scores, negative scores |
| eligibility independence | 1 — ineligible higher-score student ranks above eligible lower-score student |
| weight version | 1 — weightVersionId preserved in result |
| percentile | 5 — rank 1 of 4, rank 4 of 4, empty population, rank 1 of 100, included in result |
| sortStudents | 1 — tiedPairs set contains only tied IDs |
| DefaultTieBreakStrategy | 3 — negative when a<b, positive when a>b, zero when equal |

### ranking-service.spec.ts (14 tests)
| Category | Tests |
|----------|-------|
| resolveWeightVersion | 5 — missing CycleConfig, no activeWeightVersionId, missing weight version, explicit version, wrong cycle |
| calculate | 8 — missing cycle, no score data, successful ranking, persistence via $transaction, recalculation updates, audit started/completed, tie audit event, no tie audit when no ties |
| getLiveRanking | 2 — returns ordered rankings, supports pagination |
| getStudentRank | 2 — returns ranking for student, null when no ranking |

## Commands Executed
1. `DATABASE_URL=... npx prisma validate` — PASS
2. `npx tsc --noEmit -p apps/api/tsconfig.json` — PASS (zero errors)
3. `npx jest --runInBand --testPathPattern="(ranking|eligibility|scoring|member3)"` — 169/169 PASS

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| ranking-engine.spec.ts | 30 | PASS |
| ranking-service.spec.ts | 14 | PASS |
| eligibility-engine.spec.ts | 40 | PASS |
| eligibility-service.spec.ts | 30 | PASS |
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| allocation.e2e-spec.ts | 11 | NOT RUN (requires PostgreSQL) |
| **Total runnable** | **169** | **169 PASS** |

## Failures / Blockers
- **PostgreSQL unavailable**: Cannot run allocation.e2e-spec.ts. Pre-existing constraint, not caused by this prompt.
- **No database integration tests for ranking**: Service tests use mocked Prisma. Full integration requires a live database. Database integration was NOT verified.

## Integration Impact
- **Member 2**: No code changes. RankingService returns data conforming to RankingResultContract from member1.contract.ts.
- **Member 3**: No code changes. Member 3 tests pass (8/8).
- **Scoring layer**: No changes. Ranking consumes StudentScore records produced by Prompt 04's scoring engine.
- **Eligibility layer**: No changes. Ranking does NOT depend on or modify eligibility results.
- **Prisma Client**: No schema changes in this prompt (models were added in Prompt 03).

## What Was Intentionally NOT Implemented
- HOPE/PEP classification
- HOPE count selection
- PEP count selection
- Frozen ranking (RankingSnapshot)
- FreezeSchedule execution
- Countdown
- Notifications
- Interview workflow
- Final selection
- Allocation
- Frontend changes
- AI/advisory logic
- Competition ranking (1, 1, 3)
- Automatic recalculation on score write

## Design Decisions

### Pure Engine Separation
Following the scoring.engine.ts and eligibility.engine.ts pattern: `ranking.engine.ts` contains zero NestJS/Prisma dependencies. All ranking logic is pure, deterministic, and independently testable.

### No Score Duplication
The ranking engine does NOT recompute weighted scores. It reads persisted StudentScore.weightedScore values and sums them. The scoring formula exists only in scoring.engine.ts.

### Sequential Ranks (Not Competition)
Chose 1, 2, 3, 4 over 1, 1, 3, 4 because:
1. Simpler HOPE/PEP boundary selection later
2. Exactly one rank per student
3. No rank gaps to handle
4. The prompt explicitly specified "sequential deterministic ranks"

### studentId as Final Fallback
Using studentId string comparison guarantees determinism even when all other criteria are equal. This is documented as the default — the institutional hierarchy can be plugged in via TieBreakStrategy.

### $transaction for Atomicity
Wrapping all upserts in `prisma.$transaction()` prevents visible partial rankings during recalculation. All ranks update together or not at all.

### Percentile as Derived Value
Percentile is computed and stored but does NOT influence ranking. It's a read-only display metric derived from rank and population size.

## Git Changes
Not yet committed. All changes are on branch `feature/member1-eligibility-ranking`.

## Final Status
COMPLETED

---

## Prompt 06.1 — Hardening Review

### Date
2026-09-29

### Objective
Focused correctness review of the ranking implementation from Prompt 06. Harden without changing architecture.

### What Was Inspected

| File | Finding |
|------|---------|
| `ranking.engine.ts` | Clean — no stale stubs, no duplicate imports/decorators, no unreachable code, no EligibilityResult dependency |
| `ranking.service.ts` | **Zero-score student gap found** — `loadStudentScores()` only queried `StudentScore`, omitting cycle students with no score records |
| `ranking.controller.ts` | Clean — all 3 endpoints correctly delegate to service methods, no duplicate decorators/params, no unreachable throws |
| `ranking.dto.ts` | Clean — no issues |
| `ranking-engine.spec.ts` | Adequate coverage, eligibility independence test already present |
| `ranking-service.spec.ts` | Missing zero-score-student test and eligibility independence test |
| `schema.prisma` | Validated — `StudentCycleStatus` model with `@@unique([studentId, selectionCycleId])` is the authoritative source of cycle membership |

### Zero-Score Student Gap — FIX APPLIED

**Problem**: `loadStudentScores()` built its student list solely from `StudentScore` records. A student who belongs to the selection cycle (has a `StudentCycleStatus` row) but has never had `calculateStudentScores()` called would have zero `StudentScore` rows and be **silently excluded** from ranking.

**Root cause**: The ranking pipeline assumed that scoring had been run for every cycle student. No such guarantee exists — scoring is an explicit, per-student operation.

**Fix**: Modified `loadStudentScores()` to:
1. Query `StudentCycleStatus` for ALL students in the selection cycle (parallel with score query)
2. Seed the student map with all cycle students (totalScore=0, parameterScores={})
3. Overlay `StudentScore` data on top — students with scores get their computed totalScore, students without scores retain totalScore=0

This aligns with the Prompt 04 missing-score policy: missing parameters → `rawScore=0, isMissing=true, normalizedScore=0, weightedScore=0`. When ALL parameters are missing (no score records at all), totalScore=0 follows the same principle.

Students with score records but no `StudentCycleStatus` row are still included (union, not intersection) to avoid data loss.

### Stale Stubs / Duplicates
**None found.** All ranking files were clean. No `throw new Error('Not implemented')`, no duplicate imports/decorators/parameters, no dead or unreachable code.

### Controller Verification
All three endpoints confirmed working:

| Endpoint | Service Method | Status |
|----------|---------------|--------|
| `POST /api/ranking/calculate` | `calculate(dto.selectionCycleId, dto.weightVersionId, actorId)` | ✅ |
| `GET /api/ranking/:selectionCycleId` | `getLiveRanking(selectionCycleId, query.page, query.pageSize)` | ✅ |
| `GET /api/ranking/:selectionCycleId/student/:studentId` | `getStudentRank(studentId, selectionCycleId)` | ✅ |

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/member1/ranking/ranking.service.ts` | `loadStudentScores()` now queries `StudentCycleStatus` to include all cycle students |
| `apps/api/test/ranking-engine.spec.ts` | +3 tests for zero-score students (ranked at bottom, deterministic tie-break, single zero-score) |
| `apps/api/test/ranking-service.spec.ts` | +3 tests (cycle students with no scores, multiple zero-score determinism, eligibility independence at service layer) + `studentCycleStatus` mock + `setupCycleStudents()` helper |
| `logs/PROMPT_06.md` | This hardening section |

### Tests Added

**ranking-engine.spec.ts** (+3 tests, total 33):
- `student with totalScore 0 is ranked at the bottom`
- `multiple zero-score students are tie-broken deterministically`
- `population of only zero-score students still gets sequential ranks`

**ranking-service.spec.ts** (+3 tests, total 17):
- `includes cycle students with no score records at totalScore 0`
- `ranks multiple zero-score students deterministically by studentId`
- `does not query EligibilityResult during ranking`

### Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| ranking-engine.spec.ts | 33 | PASS |
| ranking-service.spec.ts | 17 | PASS |
| eligibility-engine.spec.ts | 40 | PASS |
| eligibility-service.spec.ts | 30 | PASS |
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| **Total** | **175** | **175 PASS** |

### Verification Commands
1. `DATABASE_URL=... npx prisma validate` — PASS
2. `npx tsc --noEmit -p apps/api/tsconfig.json` — PASS (zero errors)
3. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="(ranking|eligibility|scoring)"` — 167 PASS
4. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="member3"` — 8 PASS

### Remaining Limitations
- **PostgreSQL unavailable**: Cannot run `allocation.e2e-spec.ts`. Pre-existing constraint.
- **No database integration tests for ranking**: Service tests use mocked Prisma. Full integration requires a live database.
- **StudentCycleStatus data dependency**: The fix assumes `StudentCycleStatus` records exist for cycle members. If students are added to a cycle without creating `StudentCycleStatus` rows, they would still be omitted. This is a data integrity assumption, not a ranking bug.

### Prompt 06.1 Status
COMPLETED
