# PROMPT 14 — Critical Update / Re-Freeze with Versioned Snapshots

**Date:** 2026-09-29
**Status:** COMPLETED
**Branch:** `feature/member1-eligibility-ranking`

---

## 1. Exact Full Prompt Text

PROMPT 14 — IMPLEMENT CRITICAL UPDATE / RE-FREEZE WITH VERSIONED SNAPSHOTS

You are continuing Member 1 work for Project 9.

[Full prompt delivered as part of the session — see conversation transcript for verbatim text. Key sections: A–L covering required behavior, versioning, immutability, authority, frozen classification, selection result boundary, audit, API, idempotency/failure safety, tests, regression, documentation. 21 required test scenarios listed under J.]

---

## 2. Objective

Implement a critical update / re-freeze workflow that:
- Creates a new snapshot version (v2, v3, …) without destroying previous versions
- Makes the new snapshot the authoritative frozen snapshot via the existing authority mechanism
- Runs classification from the current live ranking state into the new snapshot atomically
- Preserves fail-closed semantics
- Adds full audit trail

---

## 3. Files Inspected

| File | Purpose |
|------|---------|
| `apps/api/prisma/schema.prisma` | Verified `RankingSnapshot.@@unique([selectionCycleId, version])`, `FreezeSchedule.snapshotId`, multiple EXECUTED schedules per cycle are structurally supported |
| `apps/api/src/member1/freeze/freeze.service.ts` | Existing `executeFreeze` pattern; `$transaction` usage; version increment logic |
| `apps/api/src/member1/freeze/freeze.engine.ts` | `validateSnapshotInputs`, `assembleSnapshot`, `SnapshotStudentInput`, `ParameterScoreDetail` |
| `apps/api/src/member1/freeze/freeze.controller.ts` | Existing API shape (`POST :selectionCycleId/execute`, etc.) |
| `apps/api/src/member1/freeze/freeze.dto.ts` | DTO conventions; `ExecuteFreezeDto` pattern |
| `apps/api/src/member1/classification/classification.service.ts` | `resolveSelectionAuthority` logic; ordered by `executedAt: 'desc'`; `calculateFrozenClassification` |
| `apps/api/src/member1/classification/classification.engine.ts` | `classifyStudents`, `validateClassificationConfig`, `ClassificationInput` |
| `apps/api/src/member1/selection/selection-result.service.ts` | Reads from snapshot entries exclusively in frozen path; uses authority resolver |
| `apps/api/src/common/contracts/member1.contract.ts` | Existing contract types; no changes required |
| `apps/api/src/member1/audit/audit.service.ts` | `log()` pattern; `ScoreAuditLog` model |
| `apps/api/src/member1/member1.module.ts` | Module wiring |
| `apps/api/test/freeze-service.spec.ts` | `$transaction` mock pattern |

---

## 4. Files Created

| File | Description |
|------|-------------|
| `apps/api/test/refreeze.spec.ts` | 41 unit tests covering all 21 required scenarios plus additional assertions |

---

## 5. Files Modified

| File | Change |
|------|--------|
| `apps/api/src/member1/freeze/freeze.service.ts` | Added `refreeze()` method; added import for `classifyStudents`, `validateClassificationConfig` from classification engine |
| `apps/api/src/member1/freeze/freeze.dto.ts` | Added `RefreezeDto` with optional `reason` field |
| `apps/api/src/member1/freeze/freeze.controller.ts` | Added `POST :selectionCycleId/refreeze` endpoint; imported `RefreezeDto` |
| `docs/MEMBER_1_ARCHITECTURE.md` | Added Section 20 (Critical Update / Re-Freeze) |
| `logs/README.md` | Added Prompt 14 entry |

---

## 6. Schema / Model Impact

**No schema changes.** The existing schema already supports the full re-freeze workflow:

| Requirement | Existing support |
|-------------|-----------------|
| Multiple snapshot versions per cycle | `RankingSnapshot.@@unique([selectionCycleId, version])` |
| Duplicate version safety | Database-level unique constraint |
| Multiple EXECUTED FreezeSchedules per cycle | No uniqueness constraint on (selectionCycleId, status) |
| Authority via latest executed schedule | `resolveSelectionAuthority` already orders by `executedAt: 'desc'` |
| Historical snapshot preservation | CASCADE DELETE only on parent cycle deletion, never triggered |

No migration was required.

---

## 7. API Changes

New endpoint:

```
POST /api/freeze/:selectionCycleId/refreeze
Header: x-actor-id: <actor-id>
Body: { reason?: string }

Response 200:
{
  snapshotId: string,
  version: number,
  previousSnapshotId: string,
  previousVersion: number,
  studentCount: number,
  hopeCount: number,
  pepCount: number
}
```

---

## 8. Service / Engine Changes

### `FreezeService.refreeze()` — new method

**Pre-conditions validated:**
1. Selection cycle exists (NotFoundException)
2. At least one EXECUTED FreezeSchedule exists (ConflictException)
3. Executed schedule has a snapshotId (ConflictException)
4. Current authoritative snapshot exists (NotFoundException)
5. Active weight version configured (BadRequestException)
6. Classification config valid (BadRequestException)
7. Snapshot inputs valid — no duplicate ranks (BadRequestException)

**Flow:**
1. Audit: `REFREEZE_STARTED` with `previousSnapshotId` and `previousVersion`
2. Read live: `StudentRanking`, `StudentScore` (filtered by current weightVersion), `EligibilityResult`
3. Re-classify with `classifyStudents(inputs, { hopeCount, pepCount })`
4. Build `SnapshotStudentInput[]` from live rankings + scores + eligibility + new classification
5. Compute `nextVersion = latestSnapshotVersion + 1`
6. **Single Prisma `$transaction`:**
   - `rankingSnapshot.create` (new version)
   - `rankingSnapshotEntry.createMany` (all students)
   - `freezeSchedule.create` (`status='EXECUTED'`, `snapshotId=newSnapshot.id`, `executedAt=frozenAt`)
   - `hopePepClassification.upsert` per student (snapshotId → new snapshot)
7. Audit: `REFREEZE_COMPLETED` with both old and new snapshot info
8. Return result object

**On any error:** audit `REFREEZE_FAILED` then re-throw (transaction already rolled back).

**Imports added to freeze.service.ts:**
- `classifyStudents`, `validateClassificationConfig` from `../classification/classification.engine`

**No changes to `ClassificationService.resolveSelectionAuthority`.** The new EXECUTED FreezeSchedule has a newer `executedAt`, so the existing `orderBy: { executedAt: 'desc' }` automatically picks it up.

---

## 9. Authority Behavior

| State | Authority |
|-------|-----------|
| No freeze | `source: 'LIVE'` |
| After v1 freeze | `source: 'SNAPSHOT'`, `snapshotVersion: 1` |
| After re-freeze to v2 | `source: 'SNAPSHOT'`, `snapshotVersion: 2` |
| After re-freeze to v3 | `source: 'SNAPSHOT'`, `snapshotVersion: 3` |

`resolveSelectionAuthority` does not change. Multiple EXECUTED `FreezeSchedule` rows exist per cycle after re-freeze; the query `findFirst({ where: { status: 'EXECUTED' }, orderBy: { executedAt: 'desc' }})` picks the newest. There is never a silent LIVE fallback when an executed freeze exists.

---

## 10. Snapshot Versioning Behavior

- Versions are `Int`, 1-indexed, monotonically increasing per `selectionCycleId`
- `nextVersion = (latest version in DB) + 1`
- The DB `@@unique([selectionCycleId, version])` constraint is the final safeguard against concurrent version collisions
- No in-memory version counter

---

## 11. Immutability Guarantees

- `FreezeService.refreeze` never calls `UPDATE` or `DELETE` on `RankingSnapshot` or `RankingSnapshotEntry`
- The old `FreezeSchedule` record (status=EXECUTED, snapshotId=old) is not modified
- Historical snapshots are queryable by ID at any time
- All test assertions verify: `prisma.rankingSnapshot.create` is NOT called outside a transaction, `prisma.freezeSchedule.update` is NOT called

---

## 12. Audit Behavior

| Event | Timing | Key Fields |
|-------|--------|------------|
| `REFREEZE_STARTED` | Before live state read | `previousSnapshotId`, `previousVersion` |
| `REFREEZE_COMPLETED` | After transaction commits | `newSnapshotId`, `newVersion`, `previousSnapshotId`, `previousVersion`, `hopeCount`, `pepCount`, `frozenAt` |
| `REFREEZE_FAILED` | On any error (catch block) | `previousSnapshotId`, `previousVersion`, `error` message |

Uses existing `AuditService.log()` → `ScoreAuditLog` table. No new audit infrastructure.

---

## 13. Tests Added

**File:** `apps/api/test/refreeze.spec.ts`

| # | Test | Covers Prompt Req. |
|---|------|--------------------|
| 1 | rejects if selection cycle not found | Pre-condition |
| 2 | rejects if no executed freeze exists | J.1 |
| 3 | rejects if executed freeze has no snapshotId | J.2 |
| 4 | rejects if authoritative snapshot record is missing | J.2 |
| 5 | rejects if no active weight version | Pre-condition |
| 6 | creates version 2 after version 1 | J.3 |
| 7 | creates version 3 after version 2 | J.4 |
| 8 | monotonically increments: result.version = previousVersion + 1 | J.3/J.4 |
| 9 | does not call update on the previous snapshot | J.5 |
| 10 | new snapshot has a different ID from previous | J.5 |
| 11 | previous snapshot info is returned for audit reference | J.6 |
| 12 | reads current live StudentRanking | J.7 |
| 13 | reads current live StudentScore | J.8 |
| 14 | reads current live EligibilityResult | J.9 |
| 15 | new snapshot totalStudents reflects current ranking count | J.7 |
| 16 | new snapshot entries contain current score details | J.8 |
| 17 | new snapshot entries contain current eligibility state | J.9 |
| 18 | new snapshot uses hopeCount from classification result | J.10 |
| 19 | snapshot entries carry the re-classified program | J.10 |
| 20 | HopePepClassification upserted to point to new snapshot | J.14 |
| 21 | frozen classification does not query HopePepClassification live table | J.15 |
| 22 | creates new EXECUTED FreezeSchedule pointing to new snapshot | J.11 |
| 23 | new EXECUTED schedule has executedAt set | J.11 |
| 24 | does not modify the old EXECUTED schedule | J.5/J.6 |
| 25 | resolveSelectionAuthority returns v2 after re-freeze to v2 | J.11 |
| 26 | resolveSelectionAuthority returns v3 after re-freeze to v3 | J.12 |
| 27 | authority never silently falls back to LIVE | J.13 |
| 28 | SelectionResultService returns v2 after refreeze to v2 | J.16 |
| 29 | SelectionResultService returns v3 after refreeze to v3 | J.17 |
| 30 | result reads rank and score exclusively from new snapshot entries | J.18 |
| 31 | decisionReference encodes the new snapshot version | J.18 |
| 32 | logs REFREEZE_STARTED | J.19 |
| 33 | REFREEZE_STARTED includes previousSnapshotId and previousVersion | J.19 |
| 34 | logs REFREEZE_COMPLETED on success | J.19 |
| 35 | REFREEZE_COMPLETED includes all snapshot transition info | J.19 |
| 36 | logs REFREEZE_FAILED on error and re-throws | J.19 |
| 37 | REFREEZE_FAILED includes previousSnapshotId for traceability | J.19 |
| 38 | transaction failure does not expose a partial new snapshot | J.20 |
| 39 | transaction failure preserves the old EXECUTED schedule | J.20 |
| 40 | duplicate version causes transaction to throw | J.21 |
| 41 | returns snapshotId, version, previousSnapshotId, previousVersion, studentCount, hopeCount, pepCount | Return contract |

All 21 required scenarios covered. 41 tests total.

---

## 14. Exact Test Commands

```bash
cd apps/api
npx jest --testPathPattern="refreeze" --no-coverage
npx jest --no-coverage
```

---

## 15. Exact Test Counts

| Scope | Pass | Fail |
|-------|------|------|
| `refreeze.spec.ts` | 41 | 0 |
| Full suite | 492 | 11 (pre-existing Member 2 allocation) |

Previous baseline: 451 pass. After Prompt 14: 492 pass (+41).

---

## 16. Prisma Validation Result

```
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
→ The schema at prisma/schema.prisma is valid ✓
```

No schema changes were made.

---

## 17. TypeScript Result

```
npx tsc --noEmit --project apps/api/tsconfig.json
→ 0 errors ✓
```

---

## 18. PostgreSQL / Integration Limitations

PostgreSQL is not available locally. All 41 new tests are pure unit tests using mocked Prisma. The 11 pre-existing failures in `allocation.e2e-spec.ts` require a live database and are pre-existing Member 2 test infrastructure issues unrelated to this prompt.

---

## 19. Member 2 Impact

None. No Member 2 files were modified. The re-freeze result object (`snapshotId`, `version`, etc.) is an administrative response; Member 2 consumes `SelectionResultService` which automatically resolves to the new snapshot via the existing authority mechanism.

---

## 20. Member 3 Impact

None. No Member 3 files were modified.

---

## 21. Remaining Limitations

- Re-freeze always reads from `CycleConfig.hopeCount` / `CycleConfig.pepCount` for classification. If the admin needs different counts for the re-freeze, that would require a config update first (outside scope of this prompt).
- Re-freeze requires `StudentRanking` to exist (same pre-condition as initial freeze). If rankings have not been calculated, re-freeze will create a zero-student snapshot.
- No HTTP-level authentication/authorization guard on the refreeze endpoint (same pattern as other Member 1 admin endpoints that use `x-actor-id` header).

---

## 22. Final Implementation Status

**COMPLETED**

- `FreezeService.refreeze()` implemented and tested (41/41)
- API endpoint `POST /api/freeze/:selectionCycleId/refreeze` live
- Authority resolves to new snapshot automatically via existing mechanism
- All previous snapshot data immutable and preserved
- Full audit trail: REFREEZE_STARTED / REFREEZE_COMPLETED / REFREEZE_FAILED
- TypeScript: 0 errors
- Prisma schema: valid, no changes
- No commits, no pushes
- Member 2 and Member 3 code: untouched

---

## Prompt 14.1 — Harden Re-Freeze Against Empty Authoritative Snapshots

**Date:** 2026-09-29

### Exact Prompt

PROMPT 14.1 — HARDEN RE-FREEZE AGAINST EMPTY AUTHORITATIVE SNAPSHOTS

Prevent an invalid empty snapshot from becoming the authoritative frozen snapshot. If a selection cycle has students (per StudentCycleStatus) but StudentRanking is empty, reject the re-freeze with BadRequestException, log REFREEZE_FAILED, and leave the previous snapshot authoritative. Do NOT redesign the re-freeze architecture. Full prompt delivered as part of the session (8 required test scenarios under TESTS section).

### Issue Found

`FreezeService.refreeze()` proceeded without error when `StudentRanking` was empty because `validateSnapshotInputs([])` returns no errors (early return for empty arrays). A zero-student snapshot could become the new authoritative frozen snapshot, silently erasing the previous valid ranking state from the selection result boundary.

### Implementation

**File:** `apps/api/src/member1/freeze/freeze.service.ts`

Added guard after the `studentRanking.findMany` call inside the `try` block of `refreeze()`:

```typescript
if (rankings.length === 0) {
  const cycleStudentCount = await this.prisma.studentCycleStatus.count({
    where: { selectionCycleId },
  });
  if (cycleStudentCount > 0) {
    throw new BadRequestException(
      'Selection cycle has students but no ranking data exists. Run ranking calculation before re-freeze.',
    );
  }
}
```

**Source of truth:** `StudentCycleStatus` is the existing repository model for cycle membership. No new business rules or hardcoded thresholds were introduced.

**Distinction:**
- `cycleStudentCount === 0` → genuinely empty cycle → allowed (zero-student snapshot)
- `cycleStudentCount > 0` and `rankings.length === 0` → students without ranking data → rejected

**Fail-closed behavior preserved:**
- The guard sits inside the `try` block; the `catch` block logs `REFREEZE_FAILED` and re-throws
- No `$transaction` has run at the point of rejection → no partial snapshot, no new schedule

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/member1/freeze/freeze.service.ts` | Added empty ranking guard in `refreeze()` |
| `apps/api/test/refreeze.spec.ts` | Added `studentCycleStatus: { count: jest.fn() }` to mock factory; added `describe('empty ranking guard')` with 8 tests |
| `logs/PROMPT_14.md` | This section appended |
| `logs/README.md` | Prompt 14.1 entry added |

### Tests Added (8)

| Test | Description |
|------|-------------|
| `rejects when cycle has students but StudentRanking is empty` | J.1 |
| `rejection message mentions ranking calculation` | J.1 — message quality |
| `no new RankingSnapshot is created on this failure` | J.2 |
| `no new FreezeSchedule is created on this failure` | J.3 |
| `previous EXECUTED FreezeSchedule is not modified` | J.4 / J.5 |
| `logs REFREEZE_FAILED when guard triggers` | J.6 |
| `allows re-freeze on a genuinely empty cycle (zero students)` | Genuine empty allowed |
| `successful re-freeze with valid rankings still creates the expected student count` | J.7 / J.8 |

### Exact Test Counts

| Scope | Pass | Fail |
|-------|------|------|
| `refreeze.spec.ts` | 49 | 0 |
| Full suite | 500 | 11 (pre-existing Member 2 allocation) |

Previous baseline (after Prompt 14): 492 pass. After 14.1: 500 pass (+8).

### Prisma Validation Result

```
DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate
→ The schema at prisma/schema.prisma is valid ✓
```

No schema changes.

### TypeScript Result

```
npx tsc --noEmit --project apps/api/tsconfig.json
→ 0 errors ✓
```

### PostgreSQL Limitation

PostgreSQL is not available locally. All 8 new tests are pure unit tests using mocked Prisma. The 11 pre-existing failures require a live database.

### Final Status

**COMPLETED**

- Guard added at correct point in `refreeze()` try block
- Genuinely empty cycles (0 students) still allowed
- Cycles with students but no rankings are rejected before any state change
- REFREEZE_FAILED logged in all failure cases
- No modifications to snapshot versioning, authority resolution, SelectionResultService, or classification architecture
- No commits, no pushes
- Member 2 and Member 3 untouched
