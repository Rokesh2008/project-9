# PROMPT 13 — Selection Result and Member 2 Integration Boundary

**Date:** 2026-09-29
**Status:** COMPLETED
**Branch:** `feature/member1-eligibility-ranking`

---

## Exact Prompt Text

```
PROMPT 13 — Selection Result and Member 2 Integration Boundary

You are continuing Member 1 work on Project 9.

Repository:
- Branch: feature/member1-eligibility-ranking
- Member 1 responsibility:
  Eligibility, Scoring, Common Ranking, HOPE/PEP Classification,
  Freeze + Immutable Ranking Snapshot
- Do NOT switch branches.
- Do NOT commit.
- Do NOT push.
- Do NOT start Prompt 14.
- Work only on this prompt.

==================================================
CURRENT VERIFIED STATE
==================================================

Prompt 04:
- Weighted scoring implemented.

Prompt 05:
- Configurable eligibility engine implemented.

Prompt 06:
- ONE COMMON RANKING across ALL students implemented.

Prompt 07:
- HOPE/PEP classification implemented.

Prompt 08:
- Immutable RankingSnapshot implemented.

Prompt 09:
- Freeze lifecycle implemented.

Prompt 10:
- Scheduler-ready freeze execution implemented.

Prompt 11:
- Freeze notification event planning implemented.

Prompt 12:
- Frozen snapshot authority implemented.

Prompt 12.1:
- Executed freeze cannot silently fall back to LIVE.
- Frozen classification uses snapshot.hopeCount / snapshot.pepCount.
- 405 tests passing.
- Prisma validate passes.
- Prisma generate passes.
- TypeScript passes.
- No Member 2/3 source changes.
- Nothing committed or pushed.

IMPORTANT:
Do not rewrite existing working functionality.

==================================================
OBJECTIVE
==================================================

Create a clean Member 1 selection-result boundary that Member 2 can consume.

The responsibility split is:

Project 2
    ↓
12 parameter scores
    ↓
Member 1 scoring
    ↓
Eligibility
    ↓
ONE COMMON RANKING
    ↓
HOPE/PEP classification
    ↓
Freeze
    ↓
Immutable snapshot
    ↓
Frozen authoritative classification
    ↓
SELECTION RESULT
    ↓
Member 2 workflow

Member 1 determines the deterministic selection result based on the existing
ranking/classification/frozen-snapshot architecture.

Member 2 is responsible for its own workflow/state transitions and allocation.

Do NOT implement Member 2's workflow.

Do NOT implement interviews.

Do NOT implement final human selection.

Do NOT implement allocation.

Do NOT modify Member 2 source code.

==================================================
1. INSPECT CURRENT CONTRACTS FIRST
==================================================

Before changing code, inspect:

- apps/api/src/common/contracts/member1.contract.ts
- apps/api/src/member1/classification/
- apps/api/src/member1/ranking/
- apps/api/src/member1/freeze/
- apps/api/prisma/schema.prisma
- apps/api/src/member1/member1.module.ts
- docs/MEMBER_1_ARCHITECTURE.md
- Member 2 contracts:
  apps/api/src/common/contracts/member1.contract.ts
  apps/api/src/member2/
- Member 2 StudentCycleStatus model
- Member 2 SelectionResultContract expectations
- Member 2 RankingResultContract expectations
- Member 2 EligibilityResultContract expectations
- Member 2 workflow/status transition code

Do not assume fields.

Use the actual repository implementation as the source of truth.

==================================================
2. EXISTING MEMBER 2 CONTRACT
==================================================

The repository already contains a Member 2-facing contract similar to:

SelectionResultContract:

{
  studentId,
  selectionCycleId,
  selected,
  programCode,
  rank?,
  score?,
  decisionReference,
  evaluatedAt,
  criteriaSummary?
}

There is also:

EligibilityResultContract

and:

RankingResultContract

Inspect the exact current definitions before modifying anything.

Do NOT create a competing SelectionResultContract.

If the existing contract is sufficient, reuse it.

If it needs additional frozen-authority information, make the smallest
backward-compatible extension necessary.

==================================================
3. DEFINE SELECTION RESULT SEMANTICS
==================================================

Selection result must represent the deterministic result produced by
Member 1.

For each student, the result should be able to communicate:

- studentId
- selectionCycleId
- whether the student is selected/eligible for the current program-selection stage
- programCode where applicable
- rank
- total score
- deterministic decision reference
- evaluation timestamp
- frozen/live source where needed
- snapshotId where frozen
- snapshotVersion where frozen

Do NOT invent new business rules.

Do NOT introduce a new meaning for "selected".

Use the existing repository semantics.

If the existing Member 2 contract's `selected` field means something
different from "eligible for HOPE/PEP", inspect the code and preserve that
meaning.

If a semantic ambiguity exists, document it instead of inventing a policy.

==================================================
4. AUTHORITATIVE DATA SOURCE
==================================================

Selection result must use the correct authority.

BEFORE FREEZE:

Use the existing LIVE Member 1 state:

- live ranking
- live classification
- existing eligibility semantics

AFTER EXECUTED FREEZE:

Use the frozen snapshot as authoritative.

Do NOT combine:

- frozen rank + live score
- frozen score + live classification
- frozen ranking + live eligibility

The frozen result must come from one internally consistent snapshot.

Use the existing Prompt 12/12.1 authority resolution.

Do not create another freeze-state mechanism.

==================================================
5. SELECTION RESULT SERVICE
==================================================

Create a focused service-level operation for producing the Member 1
selection result.

Use repository naming conventions.

Conceptually:

getSelectionResults(selectionCycleId)

or an equivalent name consistent with the codebase.

The operation should:

1. Resolve selection authority.
2. If LIVE:
   - use existing live ranking/classification data.
3. If SNAPSHOT:
   - use RankingSnapshot + RankingSnapshotEntry only.
4. Produce deterministic Member 1 selection results.
5. Return the existing SelectionResultContract.
6. Include snapshot information when the source is SNAPSHOT.
7. Do not mutate RankingSnapshot or RankingSnapshotEntry.

If the existing architecture already has a suitable method, extend/reuse it
instead of creating duplicate logic.

==================================================
6. PROGRAM SEMANTICS
==================================================

Preserve the existing HOPE/PEP classification semantics.

Current architecture:

ONE COMMON RANKING
        ↓
HOPE/PEP classification

Do NOT create separate rankings.

Do NOT change the existing eligibility rules.

Preserve:

- HOPE-eligible students can go to HOPE or PEP.
- PEP-only behavior is supported only if the existing eligibility model
  provides that distinction.
- Ineligible students do not consume program slots.

Do not invent new HOPE/PEP thresholds or capacities.

==================================================
7. SELECTED FIELD SAFETY
==================================================

The word `selected` can be ambiguous because final human interview selection
is outside Member 1.

Therefore:

Inspect the existing Member 2 contract and workflow to determine what
`selected` currently means.

If Member 1 is only determining eligibility/classification for the selection
stage, do not falsely represent that as final human selection.

If the existing contract requires `selected`, map it according to the
repository's established semantics.

If necessary, document clearly that:

Member 1:
- determines deterministic eligibility/classification/ranking result.

Member 2 / staff workflow:
- handles subsequent workflow and final selection/interview stages.

Do NOT invent a final interview decision.

==================================================
8. DETERMINISTIC DECISION REFERENCE
==================================================

Inspect the existing decisionReference convention.

If a deterministic reference already exists, reuse it.

If no implementation exists, create the smallest deterministic reference
needed by the existing contract.

It must be reproducible from the authoritative selection result and should
not depend on random values.

Do NOT use:
- Math.random()
- UUID generated randomly for business identity
- timestamps as the only identity

If the repository already has a suitable identifier, reuse it.

Document exactly how it is generated.

==================================================
9. SNAPSHOT INFORMATION
==================================================

For a frozen result, consumers must be able to determine which snapshot
produced the result.

Use existing contract fields where possible:

- source
- snapshotId
- snapshotVersion

If SelectionResultContract does not currently contain these fields and the
architecture requires them, make the smallest backward-compatible extension.

Do not duplicate the SelectionAuthorityContract.

The result itself should contain enough information for Member 2 to know
that it came from the frozen snapshot.

==================================================
10. API ENDPOINT
==================================================

Inspect existing Member 1 controllers before adding an endpoint.

If no suitable endpoint exists, add one consistent with the repository.

Suggested:

GET /api/selection/:selectionCycleId/results

or another route consistent with existing conventions.

The endpoint must:

- resolve authoritative source
- return selection results
- distinguish LIVE vs SNAPSHOT
- expose snapshotId/snapshotVersion when applicable
- return appropriate NestJS errors
- not modify data

If an existing endpoint already provides this information, do not create
a duplicate endpoint.

==================================================
11. ERROR HANDLING
==================================================

Use existing NestJS exception conventions.

Required semantic cases:

1. Selection cycle does not exist.
2. No ranking/classification data exists for the cycle.
3. Executed freeze exists but snapshotId is missing.
4. Executed freeze references missing snapshot.
5. Frozen snapshot is incomplete.
6. Frozen data required for selection result is missing.
7. Invalid/inconsistent selection data.

Do NOT silently fall back from broken frozen state to LIVE.

Prompt 12.1 established fail-closed behavior.

Preserve it.

==================================================
12. IDEMPOTENCY / READ-ONLY BEHAVIOR
==================================================

Prefer a read-oriented selection-result operation.

Calling the selection-result endpoint repeatedly should produce the same
result for the same authoritative state.

Do NOT mutate:

- RankingSnapshot
- RankingSnapshotEntry

Do NOT recalculate ranking as a side effect.

Do NOT change classification as a side effect unless the repository already
defines that behavior.

Do NOT modify Member 2 workflow state.

==================================================
13. MEMBER 2 INTEGRATION BOUNDARY
==================================================

Do NOT modify Member 2 source files.

The Member 2 integration boundary should be documented clearly.

Member 2 should be able to consume:

- studentId
- selectionCycleId
- programCode
- rank
- score
- selection/eligibility state according to existing contract semantics
- decisionReference
- evaluatedAt
- source
- snapshotId
- snapshotVersion

Document the expected flow:

1. Member 2 identifies the selection cycle.
2. Member 2 obtains Member 1 selection results.
3. Member 2 uses the deterministic result in its own workflow.
4. Member 2 performs its own workflow transitions.
5. Member 1 does NOT perform allocation or final interview decisions.

Do not modify StudentCycleStatus logic.

Do not directly transition Member 2 states from Member 1.

==================================================
14. MEMBER 2 CONTRACT COMPATIBILITY
==================================================

Before modifying the contract:

Check every current usage of:

- SelectionResultContract
- EligibilityResultContract
- RankingResultContract

Make sure the change is backward compatible.

Do not break existing Member 2 compilation/tests.

If adding fields:

- prefer optional fields where appropriate
- preserve existing field names
- preserve existing field meanings

Do not rename existing contract fields.

==================================================
15. AUDIT
==================================================

Inspect existing AuditService conventions.

If the selection-result operation is read-only, do not add unnecessary audit
events.

If the repository already audits selection-result generation, reuse that
pattern.

Do not create a second audit system.

If a new audit event is genuinely necessary, explain why before implementing.

==================================================
16. TESTS
==================================================

Add focused tests.

Selection result tests should cover:

Authority:

1. No freeze → LIVE source.
2. Executed freeze + valid snapshot → SNAPSHOT source.
3. Missing snapshotId → explicit error.
4. Missing snapshot → explicit error.

Live selection results:

5. Correct student IDs.
6. Correct rank.
7. Correct score.
8. Correct program classification.
9. Deterministic decisionReference.
10. Repeated reads return equivalent results.

Frozen selection results:

11. Uses snapshot rank.
12. Uses snapshot score.
13. Uses snapshot eligibility/classification data.
14. Includes snapshotId.
15. Includes snapshotVersion.
16. Does not read live ranking as a fallback.
17. Does not read live scores as a fallback.
18. Does not read live eligibility as a fallback.
19. Snapshot remains unchanged.
20. Repeated frozen reads are deterministic.

Contract compatibility:

21. Existing SelectionResultContract consumers still compile.
22. Existing classification/ranking tests remain passing.

Error cases:

23. Missing cycle.
24. Missing live data.
25. Missing snapshot.
26. Incomplete snapshot.
27. Invalid frozen selection data.

Do not weaken existing tests.

==================================================
17. REGRESSION
==================================================

Run all relevant suites:

- scoring-engine
- scoring-service
- eligibility-engine
- eligibility-service
- ranking-engine
- ranking-service
- classification-engine
- classification-service
- frozen-authority
- freeze-engine
- freeze-service
- freeze-lifecycle
- freeze-scheduler
- freeze-notification-engine
- freeze-notification-service
- selection-result tests
- Member 3 tests

Also run Member 2 tests if included in the repository's standard Jest run.

If Member 2 allocation.e2e-spec fails because PostgreSQL is unavailable:

- do not modify Member 2 code
- report the exact failure
- distinguish infrastructure failure from Member 1 failure

Do not hide failures.

==================================================
18. DATABASE SAFETY
==================================================

Prefer NO schema changes.

This prompt should normally require no migration.

Do NOT:

- prisma migrate reset
- delete database
- rewrite migrations
- destructive schema changes

If a schema change is genuinely required:

STOP and explain why before making it.

==================================================
19. BUILD VERIFICATION
==================================================

Run:

DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate

DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

npx tsc --noEmit --project apps/api/tsconfig.json

Run the relevant Jest suites.

Report exact per-suite test counts.

Do not guess totals.

==================================================
20. DOCUMENT MEMBER 2 CONSUMPTION
==================================================

Update:

docs/MEMBER_1_ARCHITECTURE.md

Add a concise section describing:

"Member 2 Selection Result Integration"

Document:

- authoritative source resolution
- selection-result endpoint
- SelectionResultContract fields
- LIVE vs SNAPSHOT behavior
- snapshotId/snapshotVersion behavior
- what Member 2 is responsible for
- what Member 1 is NOT responsible for
- no direct Member 2 state mutation

Do not rewrite unrelated architecture sections.

==================================================
21. LOGGING
==================================================

Create:

logs/PROMPT_13.md

The log MUST contain:

1. Exact Prompt 13 text
2. Date
3. Branch
4. Files inspected
5. Existing SelectionResultContract analysis
6. Existing Member 2 integration analysis
7. Selection result semantics
8. Authority resolution
9. Live selection-result behavior
10. Frozen selection-result behavior
11. Decision reference behavior
12. API changes
13. Contract changes
14. Member 2 integration boundary
15. Member 3 impact
16. Audit behavior
17. Error handling
18. Files created
19. Files modified
20. Schema changes
21. Migration details if applicable
22. Tests added
23. Exact test results
24. Prisma validation
25. Prisma generation
26. TypeScript result
27. PostgreSQL limitations
28. Remaining limitations
29. Intentionally unimplemented functionality
30. Final status

The COMPLETE exact Prompt 13 text must be included.

Update:

logs/README.md

with the Prompt 13 entry.

Do NOT create Prompt 14.

==================================================
22. FINAL DIFF REVIEW
==================================================

Before stopping:

- inspect git status
- inspect git diff
- inspect git diff --stat
- verify only intended Member 1 files changed
- verify no Member 2 source changes
- verify no Member 3 source changes
- verify no frontend changes
- verify no AI changes
- verify no notification-provider changes
- verify no scheduler changes
- verify no snapshot mutation
- verify no destructive migration
- verify no previous migration changes
- verify no contract breaking changes
- verify nothing committed
- verify nothing pushed

==================================================
SUCCESS CRITERIA
==================================================

Prompt 13 is complete only if:

1. Existing SelectionResultContract was inspected and reused/extended safely.
2. No competing selection-result contract was created.
3. Selection result uses the correct LIVE authority before freeze.
4. Selection result uses the immutable SNAPSHOT after freeze.
5. Broken executed-freeze state never falls back to LIVE.
6. Rank comes from the authoritative source.
7. Score comes from the authoritative source.
8. Program classification comes from the authoritative source.
9. SnapshotId is included for frozen results.
10. SnapshotVersion is included for frozen results.
11. DecisionReference is deterministic.
12. Selection-result reads do not mutate snapshots.
13. Selection-result reads do not recalculate ranking.
14. Member 2 source code is untouched.
15. Member 2 receives a clean integration boundary.
16. Member 1 does not perform interviews.
17. Member 1 does not perform final human selection.
18. Member 1 does not perform allocation.
19. Existing Member 2 contract consumers remain compatible.
20. Tests cover LIVE and SNAPSHOT paths.
21. Tests cover broken frozen states.
22. Tests cover deterministic results.
23. All relevant regression tests pass.
24. Prisma validate passes.
25. Prisma generate passes.
26. TypeScript passes.
27. Architecture documentation is updated.
28. logs/PROMPT_13.md contains the complete exact prompt and results.
29. logs/README.md is updated.
30. Nothing is committed.
31. Nothing is pushed.

STOP after Prompt 13.
```

---

## 1. Files Inspected

- `apps/api/src/common/contracts/member1.contract.ts` — existing contracts
- `apps/api/src/common/contracts/member3.contract.ts` — Member 3 contracts (no Member 2 contracts file found)
- `apps/api/src/member1/classification/classification.service.ts` — authority resolution, frozen/live classification
- `apps/api/src/member1/classification/classification.controller.ts` — existing endpoints
- `apps/api/src/member1/ranking/ranking.service.ts` — live ranking methods
- `apps/api/src/member1/eligibility/eligibility.service.ts` — eligibility methods
- `apps/api/src/member1/freeze/freeze.service.ts` — freeze execution, snapshot assembly
- `apps/api/src/member1/freeze/snapshot.controller.ts` — snapshot read endpoints
- `apps/api/src/member1/member1.module.ts` — module registration
- `apps/api/prisma/schema.prisma` — RankingSnapshot, RankingSnapshotEntry, HopePepClassification, StudentRanking, StudentScore
- `docs/MEMBER_1_ARCHITECTURE.md` — architecture documentation
- `apps/api/src/member1/audit/audit.service.ts` — audit pattern

---

## 2. Existing SelectionResultContract Analysis

The contract already existed in `apps/api/src/common/contracts/member1.contract.ts`:

```typescript
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
}
```

**Findings:**
- No `source`, `snapshotId`, or `snapshotVersion` fields — needed for frozen authority identification.
- `selected: boolean` — the existing contract uses this field. It does NOT represent "final human selection" (Member 2 does that). Member 1 maps it as `program !== 'NOT_ELIGIBLE'`, meaning the student is classified into a program (HOPE or PEP). This mapping preserves the existing semantics.
- No competing SelectionResultContract exists — the contract was extended in-place.
- `EligibilityResultContract` and `RankingResultContract` unchanged.

**No Member 2 source directory found.** The repository contains no `apps/api/src/member2/` directory — Member 2 logic is represented by models in the shared schema and the `member1.contract.ts` file. No Member 2 source files were modified.

---

## 3. Existing Member 2 Integration Analysis

Member 2 has no standalone source module in this repository. Integration is via:
- The shared Prisma schema (Member 2 owns: `Student`, `SelectionCycle`, `StudentCycleStatus`, `AssessmentResult`)
- The `member1.contract.ts` shared contract file
- Member 2 e2e test: `allocation.e2e-spec.ts` (11 tests — all pre-existing PostgreSQL connection failures)

Member 2 workflow state transitions and allocation are entirely absent from Member 1 implementation, as required.

---

## 4. Selection Result Semantics

The `selected` field is mapped as:

```typescript
selected: program !== 'NOT_ELIGIBLE'
```

This means: the student has been classified into a program slot (HOPE or PEP). It does NOT mean final human interview selection — that is Member 2's responsibility. The semantic was chosen to match the existing contract's boolean field while accurately representing Member 1's determination.

`programCode` maps directly to the `HopePepClassification.program` field: `'HOPE'`, `'PEP'`, or `'NOT_ELIGIBLE'`.

---

## 5. Authority Resolution

`SelectionResultService` delegates authority resolution entirely to the existing `ClassificationService.resolveSelectionAuthority()` — no duplicate freeze-state mechanism. Errors propagate directly (no catch-and-return-LIVE):

| State | Result |
|-------|--------|
| No executed freeze | `source: 'LIVE'` |
| Executed freeze + valid snapshot | `source: 'SNAPSHOT'` with snapshotId/snapshotVersion |
| Executed freeze + null snapshotId | `ConflictException` propagated |
| Executed freeze + missing snapshot | `NotFoundException` propagated |

---

## 6. Live Selection-Result Behavior

Live path reads from:
- `HopePepClassification` for program, rank, classifiedAt
- `StudentRanking` for totalScore

Sorted by rank ascending. Returns `source: 'LIVE'` with no snapshot fields. Throws `NotFoundException` if no classification data exists.

---

## 7. Frozen Selection-Result Behavior

Frozen path reads from:
- `RankingSnapshotEntry` for rank, totalScore, program (from snapshot)
- `HopePepClassification` (filtered by snapshotId) for frozen program classification
- Program falls back to entry-level `program` field if no matching frozen classification record exists

Does NOT read from:
- `StudentRanking` (live)
- `StudentScore` (live)
- `EligibilityResult` (live)

Returns `source: 'SNAPSHOT'` with `snapshotId` and `snapshotVersion`. Throws `BadRequestException` if snapshot entries are missing but `totalStudents > 0`.

---

## 8. Decision Reference Behavior

Deterministic, reproducible from result fields. No random values or timestamps as identity.

Format:
- **LIVE**: `SEL:<selectionCycleId>:<studentId>:LIVE`
- **SNAPSHOT**: `SEL:<selectionCycleId>:<studentId>:SNAP:<snapshotId>:v<snapshotVersion>`

Uniquely identifies each student's result within a cycle and source state.

---

## 9. API Changes

Two new endpoints added under `GET /api/selection/...`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/selection/:selectionCycleId/results` | GET | All selection results for a cycle (LIVE or SNAPSHOT) |
| `/api/selection/:selectionCycleId/results/:studentId` | GET | Single student selection result |

No existing endpoints modified or removed.

---

## 10. Contract Changes

Extended `SelectionResultContract` with three optional fields (backward compatible):

```typescript
export interface SelectionResultContract {
  // ... existing fields unchanged ...
  source?: 'LIVE' | 'SNAPSHOT';   // NEW — which source produced the result
  snapshotId?: string;             // NEW — populated when source = SNAPSHOT
  snapshotVersion?: number;        // NEW — populated when source = SNAPSHOT
}
```

All additions are optional — no existing consumer is broken.

---

## 11. Member 2 Integration Boundary

- Member 2 has no source files in this repository — nothing to modify.
- Member 2 can call `GET /api/selection/:selectionCycleId/results` to get Member 1's deterministic result.
- Member 2 can call `GET /api/classification/:selectionCycleId/authority` to check freeze state.
- Member 1 does NOT transition `StudentCycleStatus`.
- Member 1 does NOT perform allocation, interviews, or final selection.
- The integration boundary is documented in `docs/MEMBER_1_ARCHITECTURE.md` (new section: "Member 2 Selection Result Integration").

---

## 12. Member 3 Impact

None. No Member 3 code modified. All 8 `member3.e2e-spec` tests pass.

---

## 13. Audit Behavior

`SelectionResultService` is read-only — no audit events emitted. This is correct: reading a selection result is not an administrative action. The existing `FROZEN_CLASSIFICATION_STARTED/COMPLETED/FAILED` audit events from Prompt 12 remain for write operations. Adding audit for read-only queries would produce noise.

---

## 14. Error Handling

| Scenario | Exception | Message |
|----------|-----------|---------|
| Missing cycle | `NotFoundException` | Selection cycle not found |
| No live classification data | `NotFoundException` | No classification data found for this cycle. Run classification first. |
| Executed freeze + null snapshotId | `ConflictException` (propagated from ClassificationService) | Executed freeze has no snapshot. Frozen selection cannot resolve an authoritative snapshot. |
| Executed freeze + missing snapshot | `NotFoundException` (propagated) | Snapshot referenced by executed freeze not found |
| Incomplete snapshot (entries 0, totalStudents > 0) | `BadRequestException` | Snapshot is incomplete — expected entries are missing |
| Zero-student snapshot | Returns empty array (valid state) | — |
| Student not found | Returns `null` | — |

No silent fallback to live data for any broken frozen state.

---

## 15. Files Created

| File | Purpose |
|------|---------|
| `apps/api/src/member1/selection/selection-result.service.ts` | SelectionResultService — authority resolution, live/frozen result building |
| `apps/api/src/member1/selection/selection-result.controller.ts` | Two GET endpoints under /api/selection |
| `apps/api/test/selection-result.spec.ts` | 36 tests covering all paths |
| `logs/PROMPT_13.md` | This log file |

## 16. Files Modified

| File | Change |
|------|--------|
| `apps/api/src/common/contracts/member1.contract.ts` | Extended `SelectionResultContract` with optional `source`, `snapshotId`, `snapshotVersion` |
| `apps/api/src/member1/member1.module.ts` | Registered `SelectionResultService` and `SelectionResultController`; exported `SelectionResultService` |
| `docs/MEMBER_1_ARCHITECTURE.md` | Appended "Member 2 Selection Result Integration" section |
| `logs/README.md` | Added Prompt 13 entry |

---

## 17. Schema Changes

None. No schema changes required. All needed fields existed:
- `HopePepClassification.program`, `rank`, `classifiedAt`, `snapshotId`
- `RankingSnapshotEntry.rank`, `totalScore`, `isEligible`, `program`
- `StudentRanking.totalScore`, `rank`
- `FreezeSchedule.status`, `snapshotId`

---

## 18. Migration Details

None needed. No schema changes.

---

## 19. Tests Added

**selection-result.spec.ts — 36 tests:**

*Authority resolution (4 tests):*
1. Returns LIVE source when no freeze exists
2. Returns SNAPSHOT source when executed freeze exists
3. Propagates ConflictException for missing snapshotId
4. Propagates NotFoundException for missing snapshot

*Live selection results (6 tests):*
5. Returns correct student IDs
6. Returns correct rank
7. Returns correct score from StudentRanking
8. Returns correct program classification
9. Produces deterministic decisionReference
10. Repeated reads return equivalent results

*Frozen selection results (10 tests):*
11. Uses snapshot rank
12. Uses snapshot score
13. Uses snapshot eligibility/classification data
14. Includes snapshotId
15. Includes snapshotVersion
16. Does not read live StudentRanking as a fallback
17. Does not read live scores as a fallback
18. Does not read live eligibility as a fallback
19. Snapshot remains unchanged (read-only)
20. Repeated frozen reads are deterministic
21. Frozen decisionReference includes snapshot info

*Contract compatibility (2 tests):*
22. Returns all SelectionResultContract fields for live
23. Returns all SelectionResultContract fields for snapshot

*Error cases (5 tests):*
24. Throws NotFoundException for missing cycle
25. Throws NotFoundException when no live classification data exists
26. Throws BadRequestException for incomplete snapshot
27. Returns empty array for zero-student snapshot
28. Propagates authority resolution errors

*getStudentSelectionResult (4 tests):*
29. Returns null for student not found in live
30. Returns null for student not found in snapshot
31. Returns live result for specific student
32. Returns frozen result for specific student

*decisionReference (4 tests):*
33. Is deterministic for same inputs
34. Differs between students
35. Differs between LIVE and SNAPSHOT
36. Includes snapshotId and version for SNAPSHOT

---

## 20. Exact Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| scoring-engine | 28 | PASS |
| scoring-service | 19 | PASS |
| eligibility-engine | 48 | PASS |
| eligibility-service | 22 | PASS |
| ranking-engine | 29 | PASS |
| ranking-service | 21 | PASS |
| classification-engine | 29 | PASS |
| classification-service | 16 | PASS |
| freeze-engine | 18 | PASS |
| freeze-service | 39 | PASS |
| freeze-lifecycle | 35 | PASS |
| freeze-scheduler | 18 | PASS |
| freeze-notification-engine | 17 | PASS |
| freeze-notification-service | 21 | PASS |
| frozen-authority | 37 | PASS |
| **selection-result** | **36** | **PASS** |
| member3.e2e-spec | 8 | PASS |
| **TOTAL (Member 1)** | **441** | **ALL PASS** |

Note: `allocation.e2e-spec` (Member 2) has 11 pre-existing failures due to PostgreSQL not running locally — completely unrelated to Prompt 13 changes.

---

## 21. Prisma Validation

```
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid
```

## 22. Prisma Generation

```
Generated Prisma Client (v6.12.0)
```

## 23. TypeScript Result

```
npx tsc --noEmit --project apps/api/tsconfig.json
(no errors)
```

---

## 24. PostgreSQL Limitations

PostgreSQL is not running locally. No schema changes were needed for this prompt. All tests use mocked Prisma service.

---

## 25. Remaining Limitations

- `selected: boolean` maps as `program !== 'NOT_ELIGIBLE'` — represents "classified into a program slot", not final human interview selection. Final interview/selection is Member 2's responsibility.
- `criteriaSummary` field in SelectionResultContract is not populated — no criteria summary logic is implemented (not required by this prompt).
- No authentication/authorization on selection endpoints — consistent with all other Member 1 endpoints.
- Single student endpoint returns `null` rather than a 404 when the student has no classification — consistent with the pattern in `getStudentClassification()`.

---

## 26. Intentionally Unimplemented Functionality

Per prompt and standing constraints:
- Interviews
- Final human selection
- Allocation
- Member 2 workflow/state transitions from Member 1
- StudentCycleStatus mutations
- Notification delivery
- Frontend
- AI
- Background scheduler changes
- Redis/Bull/BullMQ
- WebSocket real-time updates
- Authentication/authorization
- criteriaSummary population

---

## 27. Final Status

**COMPLETED.** All 31 success criteria met:

1. Existing `SelectionResultContract` inspected and extended safely (3 optional fields added) ✓
2. No competing SelectionResultContract created ✓
3. Selection result uses LIVE authority before freeze ✓
4. Selection result uses immutable SNAPSHOT after freeze ✓
5. Broken executed-freeze state never falls back to LIVE ✓
6. Rank comes from authoritative source (StudentRanking for LIVE, RankingSnapshotEntry for SNAPSHOT) ✓
7. Score comes from authoritative source ✓
8. Program classification comes from authoritative source ✓
9. snapshotId included for frozen results ✓
10. snapshotVersion included for frozen results ✓
11. decisionReference is deterministic ✓
12. Selection-result reads do not mutate snapshots ✓
13. Selection-result reads do not recalculate ranking ✓
14. Member 2 source code untouched (no Member 2 source directory exists) ✓
15. Member 2 receives clean integration boundary (documented in architecture doc) ✓
16. Member 1 does not perform interviews ✓
17. Member 1 does not perform final human selection ✓
18. Member 1 does not perform allocation ✓
19. Existing Member 2 contract consumers remain compatible (all additions optional) ✓
20. Tests cover LIVE and SNAPSHOT paths ✓
21. Tests cover broken frozen states ✓
22. Tests cover deterministic results ✓
23. All 441 Member 1 regression tests pass (17 suites) ✓
24. Prisma validate passes ✓
25. Prisma generate passes ✓
26. TypeScript passes ✓
27. Architecture documentation updated ✓
28. logs/PROMPT_13.md contains complete exact prompt and results ✓
29. logs/README.md updated ✓
30. Nothing committed ✓
31. Nothing pushed ✓

---

## Prompt 13 Hardening — Frozen Selection Result Authority

**Date:** 2026-09-29

### Issue Found

The original `buildFrozenResults` and `buildFrozenStudentResult` methods queried `HopePepClassification` as the primary data source for `programCode` and `evaluatedAt`, using `RankingSnapshotEntry.program` only as a fallback. This violated the invariant that the frozen path must read exclusively from the immutable snapshot tables.

Specifically:
- `buildFrozenResults` called `hopePepClassification.findMany` filtered by snapshotId, used that as the primary classification source
- `buildFrozenStudentResult` called `hopePepClassification.findUnique` and used its `program` and `classifiedAt`

### Correction Applied

**File:** `apps/api/src/member1/selection/selection-result.service.ts`

Both frozen private methods rewritten:

1. `buildFrozenResults()` — parallel `Promise.all([rankingSnapshot.findFirst, rankingSnapshotEntry.findMany])`, `programCode` from `entry.program` directly, `evaluatedAt` from `snapshot.frozenAt`.
2. `buildFrozenStudentResult()` — parallel `Promise.all([rankingSnapshot.findFirst, rankingSnapshotEntry.findFirst])`, `programCode` from `entry.program` directly, `evaluatedAt` from `snapshot.frozenAt`.

Tables **never queried** in frozen path: `HopePepClassification`, `StudentRanking`, `StudentScore`, `EligibilityResult`.

### Tests Updated

**File:** `apps/api/test/selection-result.spec.ts`

Changes:
- Removed `setupFrozenClassifications` helper (frozen path no longer queries `HopePepClassification`)
- Added `setupSnapshot()` helper that stubs `rankingSnapshot.findFirst` with a `frozenAt` timestamp
- Updated all frozen tests to call `setupSnapshot()` instead of classification helper
- `returns frozen result for specific student` — removed `hopePepClassification.findUnique` mock, added `rankingSnapshot.findFirst` mock
- Added new `describe('frozen result source strictness')` block with 10 hardening tests

### New Tests Added

| Test Name | What It Asserts |
|-----------|-----------------|
| `programCode comes from RankingSnapshotEntry.program, not HopePepClassification` | `hopePepClassification.findMany/findUnique` NOT called |
| `frozen result does not query HopePepClassification.findMany` | Explicit spy assertion |
| `frozen result does not query StudentRanking` | `studentRanking.findMany/findUnique` NOT called |
| `frozen single-student result does not query HopePepClassification` | Covers `getStudentSelectionResult` frozen path |
| `selected=true for HOPE entry from snapshot` | Correct semantics via `entry.program` |
| `selected=true for PEP entry from snapshot` | Correct semantics via `entry.program` |
| `selected=false for NOT_ELIGIBLE entry from snapshot` | Correct semantics via `entry.program` |
| `broken frozen state still fails closed (ConflictException)` | Fail-closed preserved post-hardening |
| `broken frozen state still fails closed (NotFoundException)` | Fail-closed preserved post-hardening |
| `incomplete snapshot still throws BadRequestException` | Completeness check still works |

### selected Field Semantics

`selected: true` = student was classified into HOPE or PEP during the ranking engine run (program slot assignment). This is NOT final human interview selection, which is a Member 2 responsibility.

### Regression Results

| Metric | Value |
|--------|-------|
| selection-result.spec.ts | 46 pass / 0 fail (was 36) |
| Full suite | 451 pass / 11 fail (pre-existing Member 2 allocation) |
| Prisma validate | No schema changes (DATABASE_URL not set locally) |
| TypeScript | Clean (0 errors) |

### Documentation Updated

- `docs/MEMBER_1_ARCHITECTURE.md` — corrected SNAPSHOT behavior description (line ~1564); added Section 19 (Prompt 13 Hardening)
- `logs/PROMPT_13.md` — this section appended
- `logs/README.md` — hardening entry added

---

## Final Verification — 2026-09-29

### Commands Run

```
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate
npx tsc --noEmit --project apps/api/tsconfig.json
npx jest --testPathPattern="selection-result" --no-coverage
```

### Results

| Check | Result |
|-------|--------|
| `prisma validate` | The schema at `prisma/schema.prisma` is valid ✓ |
| `prisma generate` | Prisma Client (v6.12.0) generated successfully ✓ |
| `tsc --noEmit` | 0 errors ✓ |
| `selection-result.spec.ts` | 46 / 46 pass ✓ |

### Git State Confirmed

- Branch: `feature/member1-eligibility-ranking` (unchanged)
- No commits made
- No pushes made
- No Member 2 / Member 3 files modified
- No schema or migration changes from hardening
- All Member 1 work preserved as uncommitted working tree changes
