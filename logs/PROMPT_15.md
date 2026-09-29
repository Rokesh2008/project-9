# PROMPT 15 — Harden Weight Version Lifecycle and Explicit Ranking Recalculation

**Date:** 2026-09-29
**Status:** COMPLETED
**Branch:** `feature/member1-eligibility-ranking`

---

## 1. Objective

Prove via tests that the weight version lifecycle is correctly separated from ranking recalculation:
- Creating a new weight version does NOT auto-recalculate rankings
- Activating a weight version does NOT auto-recalculate rankings
- Explicit recalculation (`POST /api/ranking/calculate`) uses the active `WeightVersion`
- Frozen snapshots are unaffected by weight lifecycle changes
- Re-freeze after recalculation captures the post-recalculation ranking state

---

## 2. Files Inspected

| File | Findings |
|------|---------|
| `apps/api/src/member1/weights/weights.service.ts` | `createVersion()` creates immutable new version; `activate()` updates only `CycleConfig.activeWeightVersionId`; no recalculation in either path; `WEIGHT_VERSION_CREATED` and `WEIGHT_VERSION_ACTIVATED` audits already in place |
| `apps/api/src/member1/weights/weights.dto.ts` | `CreateWeightVersionDto`, `ActivateWeightVersionDto` — correct shape |
| `apps/api/src/member1/weights/weights.controller.ts` | Controller stubs (throw 'Not implemented') — out of scope for this prompt |
| `apps/api/src/member1/ranking/ranking.service.ts` | `calculate()` resolves weight version from `CycleConfig.activeWeightVersionId` (or explicit arg); logs `RANKING_CALCULATION_STARTED/COMPLETED/FAILED/TIE_RESOLVED`; upserts `StudentRanking` with `weightVersionId` |
| `apps/api/src/member1/ranking/ranking.engine.ts` | Pure function `calculateRanking()` — no DB access, no side effects |
| `apps/api/src/member1/ranking/ranking.controller.ts` | `POST /api/ranking/calculate` already wired to `RankingService.calculate()` |
| `apps/api/src/member1/scoring/scoring.service.ts` | `calculateStudentScores()` reads active weight from `CycleConfig`; stores scores keyed by `weightVersionId`; `loadActiveWeights()` returns version pointed to by `CycleConfig` |
| `apps/api/src/member1/scoring/scoring.engine.ts` | Pure engine functions — no DB access |
| `apps/api/src/member1/classification/classification.service.ts` | `resolveSelectionAuthority()` reads `FreezeSchedule` then `RankingSnapshot` — never reads `CycleConfig` or `WeightVersion` |

---

## 3. Architecture Findings

**All required separation properties are already correctly implemented.** No service changes were needed. The prompt deliverable is test coverage that formally proves these properties hold.

| Property | Status | Evidence |
|----------|--------|---------|
| `createVersion` is immutable (no updates) | ✅ Already correct | Only `weightVersion.create` called; no `update` |
| `createVersion` does not touch `CycleConfig` | ✅ Already correct | No `cycleConfig.update` call |
| `createVersion` does not trigger ranking recalculation | ✅ Already correct | No `studentRanking.upsert` call |
| `activate` updates only `CycleConfig.activeWeightVersionId` | ✅ Already correct | Single `cycleConfig.update` call |
| `activate` does not trigger ranking recalculation | ✅ Already correct | No `studentRanking.upsert`, no `studentScore.upsert` |
| Explicit `calculate()` uses active weight version | ✅ Already correct | `resolveWeightVersion()` reads from `CycleConfig` |
| `calculate()` accepts explicit `weightVersionId` override | ✅ Already correct | Bypasses `CycleConfig` when explicit ID given |
| Snapshot isolation from weight changes | ✅ Already correct | `WeightsService` has zero calls to snapshot tables |
| Authority resolution unaffected by weight changes | ✅ Already correct | `resolveSelectionAuthority` reads `FreezeSchedule`, not `CycleConfig` |

---

## 4. Files Created

| File | Description |
|------|-------------|
| `apps/api/test/weight-version-lifecycle.spec.ts` | 22 tests across 5 service-level test groups |

---

## 5. Files Modified

| File | Change |
|------|--------|
| `docs/MEMBER_1_ARCHITECTURE.md` | Added Section 21 — Weight Version Lifecycle and Explicit Ranking Recalculation |
| `logs/PROMPT_15.md` | This file |
| `logs/README.md` | Added Prompt 15 entry |

---

## 6. Schema Impact

None. No schema changes.

---

## 7. Implementation Changes

None. All separation properties were already correctly implemented. The deliverable is test coverage.

---

## 8. Tests Added (22)

**File:** `apps/api/test/weight-version-lifecycle.spec.ts`

### Group 1: Weight version immutability on creation (5)

| # | Test |
|---|------|
| 1 | creates new WeightVersion with monotonically incremented version number |
| 2 | does not modify any existing WeightVersion record |
| 3 | does not set CycleConfig.activeWeightVersionId |
| 4 | does not write to the StudentRanking table |
| 5 | logs WEIGHT_VERSION_CREATED audit event |

### Group 2: Activation updates only the active pointer (5)

| # | Test |
|---|------|
| 6 | updates CycleConfig.activeWeightVersionId to the new version |
| 7 | does not call studentRanking.upsert (no auto-recalculation) |
| 8 | does not call studentScore.upsert (no auto-recalculation) |
| 9 | logs WEIGHT_VERSION_ACTIVATED with both previousValue and newValue |
| 10 | rejects if weight version belongs to a different selection cycle |

### Group 3: Explicit recalculation respects active weight version (4)

| # | Test |
|---|------|
| 11 | resolves the active weight version from CycleConfig when no weightVersionId is given |
| 12 | uses an explicitly provided weightVersionId and does not consult CycleConfig |
| 13 | writes StudentRanking records keyed to the resolved weightVersionId |
| 14 | RANKING_CALCULATION_STARTED audit log includes the resolved weightVersionId |

### Group 4: Scoring records are keyed by weightVersionId (3)

| # | Test |
|---|------|
| 15 | stores StudentScore records with the active weightVersionId at the time of the call |
| 16 | loadActiveWeights returns the version currently pointed to by CycleConfig |
| 17 | getStudentScores filters by weightVersionId, excluding scores from other versions |

### Group 5: Frozen snapshots unaffected by weight lifecycle changes (3)

| # | Test |
|---|------|
| 18 | createVersion does not interact with the rankingSnapshot table |
| 19 | activate does not interact with rankingSnapshot or rankingSnapshotEntry tables |
| 20 | resolveSelectionAuthority returns SNAPSHOT source regardless of which weight version is active |

### Group 6: Re-freeze after recalculation captures updated ranking (2)

| # | Test |
|---|------|
| 21 | explicit recalculation writes StudentRanking records carrying the new weightVersionId |
| 22 | StudentRanking written by recalculation is the same data FreezeService reads via findMany |

---

## 9. Exact Test Commands

```bash
cd apps/api
npx jest --testPathPattern="weight-version-lifecycle" --no-coverage
npx jest --no-coverage
```

---

## 10. Exact Test Counts

| Scope | Pass | Fail |
|-------|------|------|
| `weight-version-lifecycle.spec.ts` | 22 | 0 |
| Full suite | 522 | 11 (pre-existing Member 2 allocation) |

Previous baseline: 500 pass. After Prompt 15: 522 pass (+22).

---

## 11. Prisma Validation

```
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
→ The schema at prisma/schema.prisma is valid ✓
```

No schema changes.

---

## 12. TypeScript Result

```
npx tsc --noEmit --project apps/api/tsconfig.json
→ 0 errors ✓
```

---

## 13. PostgreSQL Limitation

PostgreSQL is not available locally. All 22 tests are pure unit tests using mocked Prisma. The 11 pre-existing failures in `allocation.e2e-spec.ts` require a live database (pre-existing Member 2 issue).

---

## 14. Member 2 / Member 3 Impact

None. No Member 2 or Member 3 files were modified.

---

## 15. Final Implementation Status

**COMPLETED**

- Architecture properties proven by 22 passing tests
- No service code changes required (separation was already correct)
- Architecture documentation updated (Section 21)
- TypeScript: 0 errors
- Prisma schema: valid, no changes
- No commits, no pushes
- Member 2 and Member 3 code: untouched
