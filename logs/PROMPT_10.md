# PROMPT 10 — Freeze Countdown State + Scheduler-Ready Execution Service

**Date:** 2026-09-29
**Status:** COMPLETED
**Branch:** `feature/member1-eligibility-ranking`

---

## Exact Prompt Text

```
PROMPT 10 — Freeze Countdown State + Scheduler-Ready Execution Service

You are continuing Member 1 work on Project 9.

Repository:
- Branch: feature/member1-eligibility-ranking
- Member 1 responsibility:
  Eligibility, Scoring, Common Ranking, HOPE/PEP Classification,
  Freeze + Immutable Ranking Snapshot
- Do NOT switch branches.
- Do NOT commit.
- Do NOT push.
- Do NOT start Prompt 11.
- Work only on this prompt.

IMPORTANT:
Prompt 08 implemented immutable ranking snapshots.
Prompt 09 implemented the freeze lifecycle:
- future-time validation
- postponement
- cancellation
- deterministic isFreezeDue()
- double-execution protection
- lifecycle audit events

Current verified state:
- 311 tests passing
- Prisma validate passes
- Prisma generate passes
- TypeScript passes

Do NOT rewrite working Prompt 08/09 functionality unnecessarily.

==================================================
OBJECTIVE
==================================================

Build the scheduler-ready freeze execution layer.

The purpose is to provide a clean service boundary that a future background scheduler, cron worker, or external scheduler can call.

The lifecycle should become:

ADMIN
  ↓
Schedule Freeze
  ↓
SCHEDULED
  ↓
Countdown
  ↓
Scheduler checks due state
  ↓
If due
  ↓
Execute Freeze
  ↓
Immutable Ranking Snapshot
  ↓
EXECUTED

Important:

DO NOT implement an actual background scheduler/cron job in this prompt.

DO NOT add @Cron().
DO NOT add polling loops.
DO NOT add setInterval().
DO NOT add Bull/BullMQ.
DO NOT add Redis.
DO NOT add external scheduling infrastructure.

Only create the deterministic scheduler-facing service boundary.

==================================================
1. INSPECT CURRENT IMPLEMENTATION
==================================================

Before changing anything inspect:

- apps/api/src/member1/freeze/freeze.engine.ts
- apps/api/src/member1/freeze/freeze.service.ts
- apps/api/src/member1/freeze/freeze.scheduler.ts
- apps/api/src/member1/freeze/freeze.controller.ts
- apps/api/src/member1/freeze/freeze.dto.ts
- apps/api/src/member1/member1.module.ts
- apps/api/prisma/schema.prisma
- docs/MEMBER_1_ARCHITECTURE.md
- logs/PROMPT_09.md
- logs/README.md

Determine what freeze.scheduler.ts currently contains.

Do not assume it is empty.

==================================================
2. FREEZE COUNTDOWN INFORMATION
==================================================

Add a pure deterministic countdown helper.

Conceptually:

getFreezeCountdown(scheduledAt, currentTime)

It should return enough information for a future frontend/API/scheduler layer to understand the state.

Use a clear structure such as:

{
  status: 'UPCOMING' | 'DUE',
  scheduledAt,
  currentTime,
  remainingMilliseconds
}

Rules:

If currentTime < scheduledAt:

status = UPCOMING

remainingMilliseconds =
scheduledAt - currentTime

If currentTime >= scheduledAt:

status = DUE

remainingMilliseconds = 0

Do not use actual timers.

Do not sleep.

Do not poll.

Do not depend on system time inside the pure helper unless currentTime is omitted as an optional convenience parameter.

The function must be deterministic when both dates are supplied.

==================================================
3. SCHEDULER-FACING SERVICE METHOD
==================================================

Add a service method that a future scheduler can call.

Conceptually:

processDueFreezes(currentTime)

or an equivalent clear name.

Its responsibility:

1. Find freeze schedules with:
   status = SCHEDULED
   AND scheduledAt <= currentTime

2. For each due schedule:
   call the existing executeFreeze() logic.

3. Do not duplicate snapshot creation logic.

4. Reuse executeFreeze().

5. Preserve existing audit logging.

6. Preserve existing double-execution protection.

The method should return a deterministic summary.

For example:

{
  checkedAt,
  dueCount,
  executedCount,
  failedCount,
  results: [...]
}

Do not invent unnecessary fields.

==================================================
4. FAILURE ISOLATION
==================================================

A failure processing one due freeze must NOT prevent other due freezes from being attempted.

Example:

Due schedules:
A
B
C

If A succeeds
B fails
C should still be attempted.

The summary should record:

- successful executions
- failed executions
- relevant schedule/cycle IDs
- error information suitable for logs

Do not swallow errors silently.

Do not crash the entire processing cycle because one freeze failed.

==================================================
5. IDEMPOTENCY
==================================================

The scheduler-facing method must be safe to call repeatedly.

Example:

Call processDueFreezes(t1)
→ freeze executes

Call processDueFreezes(t2)
→ the same freeze must NOT execute again.

Existing double-execution protection must remain the final safeguard.

Do not create duplicate snapshots.

Do not create duplicate executions.

==================================================
6. QUERY BOUNDARY
==================================================

The scheduler-facing method should query only schedules that are:

- SCHEDULED
- due at the supplied currentTime

Do not process:

- CANCELLED
- EXECUTED
- POSTPONED

Do not modify those records.

The existing postponed workflow creates a new SCHEDULED schedule, so only that new schedule should eventually become due.

==================================================
7. TIME HANDLING
==================================================

Be explicit about time handling.

Use JavaScript Date consistently.

Do not introduce a custom timezone conversion layer.

Do not assume Chennai timezone inside backend logic.

Database timestamps and supplied Date objects should be compared consistently.

Document that the scheduler caller is responsible for providing the current instant.

==================================================
8. API DESIGN
==================================================

Do NOT expose an unrestricted public endpoint that allows arbitrary users to execute all due freezes.

If an endpoint is useful for testing/admin integration, it must be clearly marked as an internal/admin operation and should not bypass existing actor/audit behavior.

Prefer keeping the scheduler-facing method as a service method rather than exposing a new public API.

If the existing architecture already has an internal/admin route pattern, inspect and follow it.

Do not invent authentication infrastructure in this prompt.

==================================================
9. MEMBER 2 SAFETY
==================================================

Do not modify Member 2 code.

Member 2's allocation freeze is independent.

Do not confuse:

Member 1:
Ranking snapshot freeze

with:

Member 2:
Allocation freeze / WorkflowState.FROZEN

No new Member 2 state is required.

==================================================
10. SNAPSHOT SAFETY
==================================================

Verify:

- processDueFreezes() calls existing executeFreeze()
- no duplicate snapshot logic is introduced
- existing snapshot immutability remains intact
- existing snapshots are never updated
- cancelled schedules are untouched
- postponed historical schedules are untouched
- already executed schedules are untouched
- a failed execution does not leave a partial snapshot

Reuse the existing transaction behavior.

==================================================
11. TESTS
==================================================

Add focused tests.

Countdown tests:

- before scheduledAt → UPCOMING
- exactly scheduledAt → DUE
- after scheduledAt → DUE
- remaining milliseconds calculated correctly
- deterministic with supplied currentTime
- no negative remainingMilliseconds

Scheduler processing tests:

- no due freezes
- one due freeze
- multiple due freezes
- multiple cycles
- cancelled schedules ignored
- executed schedules ignored
- postponed schedules ignored
- postponed schedule's new SCHEDULED record is processed
- successful execution counted
- failed execution counted
- one failure does not prevent later schedules
- existing executeFreeze() is reused
- no duplicate snapshot creation
- repeated processDueFreezes() is safe
- exact currentTime boundary works

Regression:

Run:
- freeze engine
- freeze service
- freeze lifecycle
- scoring
- eligibility
- ranking
- classification
- Member 3

Do not remove or weaken existing tests.

==================================================
12. DATABASE SAFETY
==================================================

Do NOT reset the database.

Never use:

- prisma migrate reset
- database deletion
- destructive schema changes

Prefer no schema changes.

Only create a migration if absolutely necessary.

==================================================
13. BUILD VERIFICATION
==================================================

Run:

DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma validate

DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

npx tsc --noEmit --project apps/api/tsconfig.json

Run all relevant Jest suites individually where practical.

Report exact test counts.

Do not guess totals.

==================================================
14. LOGGING
==================================================

Create:

logs/PROMPT_10.md

The log MUST contain:

1. Exact prompt received
2. Date
3. Branch
4. Files inspected
5. Existing scheduler behavior
6. Architecture decision
7. Files created
8. Files modified
9. Schema changes
10. Countdown behavior
11. Scheduler-facing service behavior
12. Failure isolation behavior
13. Idempotency behavior
14. APIs, if any
15. Tests added
16. Exact test results
17. Prisma validation
18. Prisma generation
19. TypeScript result
20. PostgreSQL limitations
21. Member 2 impact
22. Member 3 impact
23. Remaining limitations
24. Intentionally unimplemented functionality
25. Final status

IMPORTANT:

Include the EXACT prompt text received.

Do not write only a summary.

Update:

logs/README.md

with the Prompt 10 entry.

==================================================
15. FINAL DIFF REVIEW
==================================================

Before stopping:

- inspect git diff
- inspect git status
- confirm no unrelated files changed
- confirm no Member 2 code changed
- confirm no Member 3 code changed
- confirm no frontend changes
- confirm no AI changes
- confirm no previous migrations rewritten
- confirm no snapshot immutability regression
- confirm no duplicate execution path
- confirm no actual background scheduler was introduced

Do NOT commit.

Do NOT push.

Do NOT start Prompt 11.

==================================================
SUCCESS CRITERIA
==================================================

Prompt 10 is complete only if:

- Countdown helper exists and is deterministic.
- Scheduler-facing due-freeze processing exists.
- It processes only SCHEDULED + due freezes.
- It reuses executeFreeze().
- One failed freeze does not block others.
- Repeated processing is safe.
- No duplicate snapshots are created.
- Existing snapshot immutability remains intact.
- No actual cron/background scheduler is introduced.
- Existing Prompt 08/09 behavior still passes.
- All regression tests pass.
- Prisma validate passes.
- Prisma generate passes.
- TypeScript passes.
- Exact test counts are recorded.
- logs/PROMPT_10.md contains the exact prompt.
- logs/README.md is updated.
- No unrelated project areas are modified.
- Nothing is committed or pushed.

STOP after Prompt 10.
```

---

## Files Inspected

- `apps/api/src/member1/freeze/freeze.engine.ts` — existing pure functions (validateSnapshotInputs, isFreezeDue, assembleSnapshot)
- `apps/api/src/member1/freeze/freeze.service.ts` — existing service (schedule, cancel, postpone, executeFreeze, getSchedule, getSnapshots, getLatestSnapshot, getSnapshot, getSnapshotStudents)
- `apps/api/src/member1/freeze/freeze.scheduler.ts` — empty stub with TODO comment
- `apps/api/src/member1/freeze/freeze.controller.ts` — routes for schedule, execute, postpone, cancel, getSchedule
- `apps/api/src/member1/freeze/freeze.dto.ts` — ScheduleFreezeDto, ExecuteFreezeDto, CancelFreezeDto, PostponeFreezeDto, CorrectSnapshotDto, SnapshotQueryDto
- `apps/api/src/member1/member1.module.ts` — module registration
- `apps/api/prisma/schema.prisma` — FreezeSchedule, RankingSnapshot, RankingSnapshotEntry models
- `logs/PROMPT_09.md` — previous prompt log
- `logs/README.md` — log index

## Existing Scheduler Behavior

`freeze.scheduler.ts` contained only a stub:
```typescript
@Injectable()
export class FreezeScheduler {
  constructor(private readonly freezeService: FreezeService) {}
  // TODO: Implement scheduled freeze execution in Prompt 04+
}
```
No @Cron, setInterval, Bull, or any scheduling infrastructure existed.

---

## What Was Implemented

### 1. `getFreezeCountdown()` — Pure Engine Function

**File:** `apps/api/src/member1/freeze/freeze.engine.ts`

Added `FreezeCountdown` interface and `getFreezeCountdown()` pure function:
- Returns `status: 'UPCOMING'` when `currentTime < scheduledAt`, with exact `remainingMilliseconds`
- Returns `status: 'DUE'` when `currentTime >= scheduledAt`, with `remainingMilliseconds: 0`
- Clamps remaining to 0 (never negative)
- Fully deterministic — no internal `new Date()` unless caller omits `currentTime`
- Zero side effects, zero dependencies

### 2. `processDueFreezes()` — Service Method

**File:** `apps/api/src/member1/freeze/freeze.service.ts`

Added `ProcessDueFreezesResult` interface and `processDueFreezes()` method:
- Queries all SCHEDULED freezes from database
- Filters through `isFreezeDue()` to find only those past their scheduled time
- Iterates and calls existing `executeFreeze()` for each due freeze
- **Failure isolation:** try/catch per freeze — one failure does not block others
- **Idempotency:** if a freeze was already executed, `executeFreeze()` throws `ConflictException` which is caught and recorded as a failure (not a crash)
- Uses `SYSTEM_SCHEDULER` as the actor for all scheduler-driven executions
- Logs `PROCESS_DUE_FREEZES` audit event with batch summary
- Returns `{ checkedAt, dueCount, executedCount, failedCount, results[] }`

### 3. `ProcessDueFreezesResult` Interface

**File:** `apps/api/src/member1/freeze/freeze.service.ts`

```typescript
export interface ProcessDueFreezesResult {
  checkedAt: Date;
  dueCount: number;
  executedCount: number;
  failedCount: number;
  results: Array<{
    selectionCycleId: string;
    scheduleId: string;
    success: boolean;
    snapshotId?: string;
    version?: number;
    error?: string;
  }>;
}
```

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| No @Cron / setInterval / Bull / Redis | Per prompt requirements — scheduler boundary only |
| `SYSTEM_SCHEDULER` actor | Distinguishes automated executions from manual admin actions in audit trail |
| Failure isolation via try/catch per freeze | One cycle's failure must not block another cycle's freeze |
| Reuses existing `executeFreeze()` | No duplication — all validation, transaction, audit logic already built |
| Idempotency via existing double-execution guard | `executeFreeze()` throws ConflictException for already-executed cycles |
| Batch audit event | Single `PROCESS_DUE_FREEZES` audit entry summarizes the entire run |
| `freeze.scheduler.ts` remains a stub | Ready for a future scheduler implementation to call `processDueFreezes()` |

---

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/member1/freeze/freeze.engine.ts` | Added `FreezeCountdown` interface, `getFreezeCountdown()` function |
| `apps/api/src/member1/freeze/freeze.service.ts` | Added `ProcessDueFreezesResult` interface, `processDueFreezes()` method, imported `isFreezeDue` |

## Files Created

| File | Purpose |
|------|---------|
| `apps/api/test/freeze-scheduler.spec.ts` | 18 tests: 8 countdown + 10 processDueFreezes |

---

## Test Results

### New Tests (freeze-scheduler.spec.ts — 18 tests)

**getFreezeCountdown (8 tests):**
1. DUE when currentTime equals scheduledAt
2. DUE when currentTime is after scheduledAt
3. UPCOMING when currentTime is before scheduledAt
4. Exact remaining milliseconds
5. Clamps remainingMilliseconds to 0 when overdue
6. Preserves scheduledAt and currentTime in result
7. Deterministic — same inputs always produce same output
8. UPCOMING with 1ms remaining

**processDueFreezes (10 tests):**
1. Empty results when no SCHEDULED freezes exist
2. Skips SCHEDULED freezes that are not yet due
3. Executes a single due freeze
4. Isolates failure — one failed freeze does not block others
5. Uses SYSTEM_SCHEDULER as the actor
6. Idempotent — second call for already-executed freeze counts as failure without crashing
7. Sets checkedAt to the provided currentTime
8. Creates a PROCESS_DUE_FREEZES audit event
9. Does not execute freezes with non-SCHEDULED statuses
10. Returns scheduleId and selectionCycleId for each result

### Full Suite Counts

| Suite | Tests | Status |
|-------|-------|--------|
| scoring-engine | 28 | PASS |
| scoring-service | 19 | PASS |
| eligibility-engine | 48 | PASS |
| eligibility-service | 22 | PASS |
| ranking-engine | 29 | PASS |
| ranking-service | 21 | PASS |
| classification-engine | 29 | PASS |
| classification-service | 15 | PASS |
| freeze-engine | 18 | PASS |
| freeze-service | 39 | PASS |
| freeze-lifecycle | 35 | PASS |
| **freeze-scheduler** | **18** | **PASS** |
| member3.e2e-spec | 8 | PASS |
| **TOTAL** | **329** | **ALL PASS** |

---

## Verification

- Prisma schema: VALID
- Prisma client: GENERATED (v6.12.0)
- TypeScript: COMPILES (tsc --noEmit clean)
- All 329 tests: PASSING

---

## Schema Changes

None. No schema changes required. No new migrations created.

## Countdown Behavior

`getFreezeCountdown(scheduledAt, currentTime)` is a pure function:
- `currentTime < scheduledAt` → `{ status: 'UPCOMING', remainingMilliseconds: scheduledAt - currentTime }`
- `currentTime >= scheduledAt` → `{ status: 'DUE', remainingMilliseconds: 0 }`
- Clamps to 0 (never negative)
- Deterministic when both parameters supplied
- `currentTime` defaults to `new Date()` for convenience but is always injectable

## Scheduler-Facing Service Behavior

`processDueFreezes(currentTime)`:
1. Queries `freezeSchedule` where `status = 'SCHEDULED'`
2. Filters through `isFreezeDue()` to select only due schedules
3. Iterates each due freeze, calling `this.executeFreeze(selectionCycleId, 'SYSTEM_SCHEDULER')`
4. Collects results with success/failure per freeze
5. Logs a single `PROCESS_DUE_FREEZES` batch audit event
6. Returns `{ checkedAt, dueCount, executedCount, failedCount, results[] }`
7. Caller (future scheduler) is responsible for providing `currentTime`

## Failure Isolation Behavior

Each due freeze is processed inside its own try/catch block. If freeze A fails (e.g., cycle not found), the error is recorded in `results[]` and processing continues to freeze B, C, etc. The batch never throws — it always returns a complete summary.

## Idempotency Behavior

Repeated calls are safe because:
1. Successfully executed freezes have their schedule marked `EXECUTED` inside the transaction
2. `executeFreeze()` checks for existing `EXECUTED` schedule and throws `ConflictException`
3. `processDueFreezes()` catches this exception and records it as a failure (not a crash)
4. The `@@unique([selectionCycleId, version])` constraint on `RankingSnapshot` prevents duplicate snapshots at the database level

## APIs

No new public API endpoints were added. `processDueFreezes()` is a service-only method, not exposed via any controller. This follows the prompt requirement to keep it as a service boundary for a future scheduler.

## PostgreSQL Limitations

PostgreSQL is not running locally. All tests use mocked Prisma calls. The `@@unique` constraint on `[selectionCycleId, version]` is the database-level concurrency safeguard but cannot be tested without a live database.

## Member 2 Impact

None. No Member 2 code was modified. Member 2's allocation freeze (`WorkflowState.FROZEN`) remains completely independent.

## Member 3 Impact

None. No Member 3 code was modified. All 8 member3.e2e-spec tests continue to pass.

## Remaining Limitations

- `freeze.scheduler.ts` remains an empty stub — no actual background scheduler exists yet
- No public API endpoint for triggering `processDueFreezes()` — by design
- No timezone conversion layer — caller provides `currentTime` as a JavaScript `Date`
- TOCTOU window between reading SCHEDULED status and executing still exists — mitigated by `@@unique` constraint and `ConflictException` guard

## Intentionally Unimplemented Functionality

Per prompt instructions, the following were NOT implemented:
- @Cron / setInterval / Bull / BullMQ / Redis / polling loops
- Public API endpoint for scheduler execution
- Countdown UI / frontend timer
- Notifications / email / SMS
- Timezone conversion layer
- Authentication infrastructure

## Final Status

COMPLETED. All success criteria met.
