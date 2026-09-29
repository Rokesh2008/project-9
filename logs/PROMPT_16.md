# PROMPT 16 — Harden Eligibility Rule Version Lifecycle and Explicit Recalculation

**Date:** 2026-09-29
**Status:** COMPLETED
**Branch:** `feature/member1-eligibility-ranking`

---

## 1. Exact Full Prompt Text

PROMPT 16 — HARDEN ELIGIBILITY RULE VERSION LIFECYCLE AND EXPLICIT RECALCULATION

[Full prompt delivered as part of the session — see conversation transcript for verbatim text. Key sections: A–Q covering rule version immutability, activation behavior, explicit recalculation, previous eligibility result behavior, rule-version consistency, frozen snapshot safety, live classification, frozen classification, re-freeze with new rules, snapshot data, audit, API, tests (27 scenarios), failure/atomicity, schema, regression, and documentation.]

---

## 2. Objective

Prove via tests that the eligibility rule version lifecycle is correctly separated from eligibility recalculation, ranking recalculation, classification recalculation, and frozen snapshot state — exactly mirroring the weight-version lifecycle from Prompt 15.

---

## 3. Files Inspected

| File | Findings |
|------|---------|
| `apps/api/prisma/schema.prisma` | `EligibilityRuleVersion` has `@@unique([selectionCycleId, version])`, `isActive` boolean flag; `EligibilityResult.ruleVersionId` exists; `RankingSnapshot.ruleVersionId?` optional field exists; `RankingSnapshotEntry` stores `isEligible` + `eligibilityFailures` |
| `apps/api/src/member1/eligibility/eligibility.service.ts` | `createRuleVersion()` — immutable new version, `isActive: false`, logs `ELIGIBILITY_RULE_VERSION_CREATED`; `activateRuleVersion()` — sets `isActive` flags + updates `CycleConfig.eligibilityRuleVersionId`, logs `ELIGIBILITY_RULE_VERSION_ACTIVATED`; `evaluate()` — explicit only, persists with `ruleVersionId`, no ranking/snapshot side effects; all required audit events exist |
| `apps/api/src/member1/eligibility/eligibility.engine.ts` | Pure evaluation functions (`evaluateEligibility`, `evaluateRule`, `validateRuleConfiguration`) — no DB access |
| `apps/api/src/member1/eligibility/eligibility.controller.ts` | `POST /api/eligibility/rules`, `POST /api/eligibility/rules/activate`, `POST /api/eligibility/evaluate` — all wired to service |
| `apps/api/src/member1/eligibility/eligibility.dto.ts` | `CreateRuleVersionDto`, `ActivateRuleVersionDto`, `EvaluateEligibilityDto` — correct shape |
| `apps/api/src/member1/classification/classification.service.ts` | `resolveSelectionAuthority()` reads `FreezeSchedule` (not eligibility tables); `loadClassificationInputs()` reads `eligibilityResult.findMany` — live classification uses current eligibility |
| `apps/api/src/member1/freeze/freeze.service.ts` | Both `executeFreeze()` and `refreeze()` read `CycleConfig.eligibilityRuleVersionId` and set `RankingSnapshot.ruleVersionId`; read `eligibilityResult.findMany` for `SnapshotStudentInput.isEligible` |
| `apps/api/test/eligibility-service.spec.ts` | Existing 19 tests covering createRuleVersion, activateRuleVersion, assembleStudentContext, evaluate pipeline, getResult |

---

## 4. Architecture Findings

**All required separation properties are already correctly implemented.** No service changes were needed. The deliverable is test coverage formally proving these properties.

| Property | Status | Evidence |
|----------|--------|---------|
| `createRuleVersion` creates immutable new version | ✅ Already correct | Only `eligibilityRuleVersion.create` called; no `update` on existing versions |
| `createRuleVersion` does not touch `EligibilityResult` | ✅ Already correct | No `eligibilityResult.upsert` call |
| `createRuleVersion` does not trigger ranking recalculation | ✅ Already correct | No `studentRanking.upsert` call |
| `activateRuleVersion` updates `CycleConfig` pointer + `isActive` flags only | ✅ Already correct | No `eligibilityResult.upsert`, no `studentRanking.upsert` |
| `activateRuleVersion` does not trigger ranking/snapshot mutation | ✅ Already correct | No `rankingSnapshot.create`, no `rankingSnapshotEntry.createMany` |
| `evaluate()` uses one resolved rule version for entire call | ✅ Already correct | `loadActiveRuleConfig()` resolved once, passed to all `evaluateStudent()` calls |
| `evaluate()` persists `ruleVersionId` in `EligibilityResult` | ✅ Already correct | `eligibilityResult.upsert.create.ruleVersionId = resolvedRuleVersionId` |
| `evaluate()` does not trigger ranking/snapshot mutation | ✅ Already correct | No calls to `studentRanking`, `rankingSnapshot`, `rankingSnapshotEntry`, `hopePepClassification` |
| Snapshot isolation from rule changes | ✅ Already correct | `EligibilityService` has zero calls to snapshot tables |
| Authority resolution unaffected by rule changes | ✅ Already correct | `resolveSelectionAuthority()` reads `FreezeSchedule`, never `eligibilityResult` or `CycleConfig` |
| `RankingSnapshot.ruleVersionId` set during freeze/refreeze | ✅ Already correct | FreezeService reads `CycleConfig.eligibilityRuleVersionId` and sets it on new snapshot |
| `RankingSnapshotEntry.isEligible` from current eligibilityResult | ✅ Already correct | FreezeService reads `eligibilityResult.findMany` for each student when building snapshot entries |

---

## 5. Files Created

| File | Description |
|------|-------------|
| `apps/api/test/eligibility-rule-lifecycle.spec.ts` | 30 tests across 6 service-level test groups |

---

## 6. Files Modified

| File | Change |
|------|--------|
| `docs/MEMBER_1_ARCHITECTURE.md` | Added Section 22 — Eligibility Rule Version Lifecycle |
| `logs/PROMPT_16.md` | This file |
| `logs/README.md` | Added Prompt 16 entry |

---

## 7. EligibilityRuleVersion Behavior

- `createRuleVersion()` — new immutable row; auto-incremented `version`; `isActive: false`; `rules` JSON stored once and never modified; logs `ELIGIBILITY_RULE_VERSION_CREATED`
- Concurrent creation protected by `@@unique([selectionCycleId, version])` — DB error propagated to caller
- Historical rule versions are never deleted or updated (rules field immutable)

---

## 8. Rule Activation Behavior

- `activateRuleVersion()` — sets `isActive: false` on all existing active versions for the cycle, `isActive: true` on the specified version
- Also updates `CycleConfig.eligibilityRuleVersionId` pointer
- Does NOT call: `eligibilityResult.upsert`, `studentRanking.upsert`, `rankingSnapshot.create`, `rankingSnapshotEntry.createMany`
- Logs `ELIGIBILITY_RULE_VERSION_ACTIVATED`

---

## 9. Eligibility Recalculation Behavior

- `evaluate()` — explicit operation only; never triggered automatically
- Resolves rule version from `CycleConfig.eligibilityRuleVersionId` (or explicit arg, bypassing CycleConfig)
- ALL students in a single call evaluated with the SAME `ruleVersionId` (resolved once before the loop)
- `EligibilityResult.upsert` stores the new `ruleVersionId`
- Does NOT call: `studentRanking.upsert`, `hopePepClassification.upsert`, `rankingSnapshot.create`, `rankingSnapshotEntry.createMany`
- Logs `ELIGIBILITY_EVALUATION_STARTED` (with `ruleVersionId`), `ELIGIBILITY_EVALUATION_COMPLETED`

---

## 10. Ranking Interaction

None. Eligibility recalculation does not touch `StudentRanking`. Ranking recalculation remains a separate explicit operation (`POST /api/ranking/calculate`).

---

## 11. Classification Interaction

- Live classification (`ClassificationService.loadClassificationInputs()`) reads `eligibilityResult.findMany` — so after explicit eligibility recalculation, the next explicit classification call picks up the new results
- Frozen classification reads from `RankingSnapshotEntry` — not from current `EligibilityResult` — so frozen results are unaffected by rule changes
- No automatic classification triggered by `createRuleVersion`, `activateRuleVersion`, or `evaluate()`

---

## 12. Frozen Snapshot Behavior

- Existing `RankingSnapshot` and `RankingSnapshotEntry` rows are NEVER modified by eligibility rule operations
- `resolveSelectionAuthority()` reads `FreezeSchedule` — completely independent of eligibility tables
- After eligibility recalculation, the frozen snapshot remains authoritative until explicit re-freeze

---

## 13. Re-Freeze Behavior

Expected sequence (already implemented and proven):
1. Activate rule v2
2. Explicit eligibility recalculation → `EligibilityResult` updated with `ruleVersionId: v2`
3. Explicit re-freeze → reads current `eligibilityResult.findMany`, builds snapshot entries with new `isEligible`
4. New `RankingSnapshot.ruleVersionId = v2` (from `CycleConfig.eligibilityRuleVersionId`)
5. New snapshot becomes authoritative (new EXECUTED `FreezeSchedule` with newer `executedAt`)

---

## 14. Audit Behavior

| Event | Trigger |
|-------|---------|
| `ELIGIBILITY_RULE_VERSION_CREATED` | `createRuleVersion()` |
| `ELIGIBILITY_RULE_VERSION_ACTIVATED` | `activateRuleVersion()` — includes `newValue.version` |
| `ELIGIBILITY_EVALUATION_STARTED` | `evaluate()` — includes `ruleVersionId` and `singleStudent` |
| `ELIGIBILITY_EVALUATION_COMPLETED` | After all students — includes totals |
| `ELIGIBILITY_EVALUATION_FAILED` | Per-student engine failure |
| `ELIGIBILITY_RULE_FAILED` | Per-student per-failed-rule |
| `ELIGIBILITY_INVALID_RULE_CONFIGURATION` | Stored config fails validation |

---

## 15. API Behavior

All required API endpoints already exist and are fully wired:

| Endpoint | Service Method |
|----------|---------------|
| `POST /api/eligibility/rules` | `createRuleVersion()` |
| `POST /api/eligibility/rules/activate` | `activateRuleVersion()` |
| `POST /api/eligibility/evaluate` | `evaluate()` |
| `GET /api/eligibility/rules/:cycleId` | `getRuleVersions()` |
| `GET /api/eligibility/:cycleId` | `getResultsByCycle()` |
| `GET /api/eligibility/:cycleId/student/:studentId` | `getResult()` |

No new endpoints required. No duplicate APIs created.

---

## 16. Schema / Migration Impact

None. All required fields already exist:
- `EligibilityResult.ruleVersionId` — tracks which version produced each result
- `RankingSnapshot.ruleVersionId?` — records active rule version at freeze time
- `RankingSnapshotEntry.isEligible` + `eligibilityFailures` — frozen eligibility state
- `CycleConfig.eligibilityRuleVersionId` — active rule version pointer
- `EligibilityRuleVersion.isActive` — activation marker

No migrations required.

---

## 17. Tests Added (30)

**File:** `apps/api/test/eligibility-rule-lifecycle.spec.ts`

### Group 1: Rule version immutability on creation (7)

| # | Test | Scenario |
|---|------|---------|
| 1 | creates new EligibilityRuleVersion row with incremented version number | 1 |
| 2 | creates with isActive: false — previous version status unchanged | 2, 3 |
| 3 | does not call eligibilityResult.upsert | 4 |
| 4 | does not call studentRanking.upsert | 5 |
| 5 | does not interact with rankingSnapshot or rankingSnapshotEntry | 12 |
| 6 | logs ELIGIBILITY_RULE_VERSION_CREATED | 22 |
| 7 | propagates DB unique-constraint error for concurrent version creation | 27 |

### Group 2: Activation — pointer update only (6)

| # | Test | Scenario |
|---|------|---------|
| 8 | updates CycleConfig.eligibilityRuleVersionId | 5 |
| 9 | does NOT call eligibilityResult.upsert | 5 |
| 10 | does NOT call studentRanking.upsert | 6 |
| 11 | does NOT call rankingSnapshot.create | 12 |
| 12 | logs ELIGIBILITY_RULE_VERSION_ACTIVATED | 23 |
| 13 | rejects if rule version belongs to different cycle | — |

### Group 3: Explicit recalculation properties (5)

| # | Test | Scenario |
|---|------|---------|
| 14 | resolves active rule version from CycleConfig | 7 |
| 15 | uses explicit ruleVersionId when provided | 7 |
| 16 | all upsert calls in one evaluation share same ruleVersionId | 8 |
| 17 | EligibilityResult.upsert stores new ruleVersionId after recalculation | 9 |
| 18 | ELIGIBILITY_EVALUATION_STARTED includes resolved ruleVersionId | 24 |

### Group 4: No automatic side effects from recalculation (5)

| # | Test | Scenario |
|---|------|---------|
| 19 | evaluate() does NOT call studentRanking.upsert | 10 |
| 20 | evaluate() does NOT call hopePepClassification.upsert | 11 |
| 21 | evaluate() does NOT call rankingSnapshot.create | 13 |
| 22 | evaluate() does NOT call rankingSnapshotEntry.createMany | 14 |
| 23 | evaluation failure does NOT touch rankingSnapshot | 25, 26 |

### Group 5: Frozen authority unaffected (3)

| # | Test | Scenario |
|---|------|---------|
| 24 | resolveSelectionAuthority returns SNAPSHOT regardless of active rule version | 15, 16 |
| 25 | loadClassificationInputs reads eligibilityResult.findMany | 17 |
| 26 | createRuleVersion does not interact with freezeSchedule/rankingSnapshot | 12 |

### Group 6: Re-freeze captures updated eligibility (4)

| # | Test | Scenario |
|---|------|---------|
| 27 | evaluate() updates eligibilityResult; findMany returns new isEligible state | 18, 19 |
| 28 | snapshot entries from re-freeze contain isEligible from current eligibilityResult | 19 |
| 29 | RankingSnapshot.ruleVersionId records the active rule version at freeze time | 19 |
| 30 | resolveSelectionAuthority returns SNAPSHOT after re-freeze | 20, 21 |

---

## 18. Exact Test Commands

```bash
cd apps/api
npx jest --testPathPattern="eligibility-rule-lifecycle" --no-coverage
npx jest --no-coverage
```

---

## 19. Exact Test Counts

| Scope | Pass | Fail |
|-------|------|------|
| `eligibility-rule-lifecycle.spec.ts` | 30 | 0 |
| Full suite | 552 | 11 (pre-existing Member 2 allocation) |

Previous baseline: 522 pass. After Prompt 16: 552 pass (+30).

---

## 20. Prisma Validation Result

```
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
→ The schema at prisma/schema.prisma is valid ✓
```

No schema changes.

---

## 21. TypeScript Result

```
npx tsc --noEmit --project apps/api/tsconfig.json
→ 0 errors ✓
```

---

## 22. PostgreSQL / Integration Limitations

PostgreSQL is not available locally. All 30 tests are pure unit tests using mocked Prisma. The 11 pre-existing failures in `allocation.e2e-spec.ts` require a live database.

**Atomicity limitation documented:** `EligibilityService.evaluate()` processes students sequentially without a wrapping transaction. If evaluation fails mid-loop, students processed before the failure will have updated `EligibilityResult` records while later students will not. This is a limitation of the current implementation and is documented in the architecture docs.

---

## 23. Member 2 Impact

None. No Member 2 files were modified.

---

## 24. Member 3 Impact

None. No Member 3 files were modified.

---

## 25. Remaining Limitations

1. **No transaction around evaluate():** Partial eligibility state is possible if evaluation fails mid-loop. Would require wrapping the student loop in a Prisma transaction with a `$transaction` call.
2. **`ELIGIBILITY_RULE_VERSION_ACTIVATED` missing `previousValue`:** Unlike `WEIGHT_VERSION_ACTIVATED`, the activation audit does not log the previously active version ID. This is a minor audit gap but within the existing implementation.
3. **No HTTP-level auth guard** on eligibility endpoints (same pattern as all other Member 1 admin endpoints using `x-actor-id` header).

---

## 26. Final Implementation Status

**COMPLETED**

- Architecture properties proven by 30 passing tests
- No service code changes required (separation was already correct)
- Architecture documentation updated (Section 22)
- TypeScript: 0 errors
- Prisma schema: valid, no changes
- No commits, no pushes
- Member 2 and Member 3 code: untouched

---

# PROMPT 16.1 — Harden Eligibility Recalculation Atomicity and Activation Audit

**Date:** 2026-09-30
**Status:** COMPLETED

---

## P16.1-1. Issues Fixed

### Issue 1: evaluate() had no transaction

**Before:** `evaluate()` called `evaluateStudent()` sequentially, each with its own `eligibilityResult.upsert`. A failure mid-loop left earlier students written and later students unwritten — partial state.

**After:** Two-phase approach:
- **Phase 1 (Compute):** All students evaluated by the pure engine. Engine failures log `ELIGIBILITY_EVALUATION_FAILED` and re-throw before any DB writes.
- **Phase 2 (Persist):** All `EligibilityResult` upsert operations committed in a single `prisma.$transaction(upsertOps)`. Transaction failure logs `ELIGIBILITY_EVALUATION_FAILED` with `metadata.phase: 'persist'`.
- `ELIGIBILITY_EVALUATION_COMPLETED` only logged after successful commit.

### Issue 2: ELIGIBILITY_RULE_VERSION_ACTIVATED missing previousValue

**Before:** The activation audit only logged `newValue: { version: ruleVersion.version }`.

**After:** `activateRuleVersion()` reads `cycleConfig.eligibilityRuleVersionId` before overwriting it, then passes:
```typescript
previousValue: previousRuleVersionId
  ? { eligibilityRuleVersionId: previousRuleVersionId }
  : undefined,
newValue: {
  eligibilityRuleVersionId: params.ruleVersionId,
  version: ruleVersion.version,
},
```

---

## P16.1-2. Files Modified

| File | Change |
|------|--------|
| `apps/api/src/member1/eligibility/eligibility.service.ts` | Two-phase evaluate(), previousValue in activation audit |
| `apps/api/test/eligibility-service.spec.ts` | Added `$transaction: jest.fn()` to mockPrisma; beforeEach restores `Promise.all` implementation |
| `docs/MEMBER_1_ARCHITECTURE.md` | Section 22 updated — atomicity limitation removed, two-phase design documented |
| `logs/PROMPT_16.md` | This section |
| `logs/README.md` | Added P16.1 entry |

## P16.1-3. Files Created

| File | Description |
|------|-------------|
| `apps/api/test/eligibility-atomicity.spec.ts` | 16 tests across 2 groups |

---

## P16.1-4. Tests Added (16)

**File:** `apps/api/test/eligibility-atomicity.spec.ts`

### Group 1: Atomic Commit (13 tests)

| # | Test |
|---|------|
| 1 | calls $transaction exactly once for a multi-student evaluation |
| 2 | passes one upsert op per student to $transaction |
| 3 | all upsert calls in one evaluate() use the same ruleVersionId |
| 4 | logs ELIGIBILITY_EVALUATION_COMPLETED only after successful $transaction |
| 5 | does NOT call $transaction when engine throws during compute phase |
| 6 | propagates assembleStudentContext failure without logging EVALUATION_FAILED |
| 7 | does NOT log ELIGIBILITY_EVALUATION_COMPLETED after compute-phase failure |
| 8 | logs ELIGIBILITY_EVALUATION_FAILED with phase:persist when $transaction throws |
| 9 | does NOT log ELIGIBILITY_EVALUATION_COMPLETED after $transaction failure |
| 10 | does NOT call studentRanking.upsert on successful evaluation |
| 11 | does NOT call studentRanking.upsert on evaluation failure |
| 12 | does NOT call rankingSnapshot.create or rankingSnapshotEntry.createMany |
| 13 | does NOT call hopePepClassification.upsert on evaluation |

### Group 2: Activation Audit previousValue (3 tests)

| # | Test |
|---|------|
| 14 | ELIGIBILITY_RULE_VERSION_ACTIVATED includes previousValue when prior version existed |
| 15 | ELIGIBILITY_RULE_VERSION_ACTIVATED includes newValue with version number |
| 16 | ELIGIBILITY_RULE_VERSION_ACTIVATED omits previousValue when no prior version configured |

---

## P16.1-5. Test Counts

| Scope | Pass | Fail |
|-------|------|------|
| `eligibility-atomicity.spec.ts` | 16 | 0 |
| `eligibility-service.spec.ts` | 19 | 0 |
| `eligibility-rule-lifecycle.spec.ts` | 30 | 0 |
| Full suite | 568 | 11 (pre-existing Member 2) |

Previous baseline (P16): 552 pass. After P16.1: 568 pass (+16).

---

## P16.1-6. TypeScript / Prisma

- `npx tsc --noEmit` → 0 errors
- `npx prisma validate` → schema valid, no changes

---

## P16.1-7. Final Implementation Status

**COMPLETED**

- Two-phase atomic evaluate() implemented
- Activation audit previousValue added
- 16 new tests passing (568 total)
- Existing 19 eligibility-service tests still pass (no regressions)
- TypeScript: 0 errors
- No commits, no pushes
- Member 2 and Member 3 code: untouched
