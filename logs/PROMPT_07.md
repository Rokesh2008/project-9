# Prompt 07

## Prompt Given
Implement the HOPE/PEP classification layer that consumes the existing ONE common live ranking. Classification reads ranking + eligibility + cycle configuration. Do NOT implement freeze/snapshot/notifications/interview/final selection.

## Objective
Build the classification pipeline: load live StudentRanking → load EligibilityResult → load CycleConfig (hopeCount/pepCount) → classify students into HOPE/PEP/NOT_ELIGIBLE → persist via transaction → audit logging → API endpoints. Classification consumes the existing common ranking and does NOT modify it.

## Previous Findings Used
- ONE common ranking for ALL students (Prompt 06)
- EligibilityResult.isEligible boolean (Prompt 05)
- CycleConfig.hopeCount and CycleConfig.pepCount (Prompt 03 schema)
- HopePepClassification model with @@unique([studentId, selectionCycleId]) (Prompt 03 schema)
- ClassificationStatus enum: CLASSIFIED, HOPE_INTERVIEW_FAILED, PEP_FALLBACK_ALLOWED, PEP_FALLBACK_DENIED
- Architecture doc Section 10: Classification Design
- Pure engine + service separation pattern (Prompts 04, 05, 06)
- AuditService.log() with Prisma.InputJsonValue/JsonNull casting
- Missing-score policy: rawScore=0, isMissing=true (Prompt 04) — students with zero scores get totalScore=0 and rank at bottom

## Classification Architecture

### Pipeline
```
12 parameter scores
    ↓
weighted scores (Prompt 04)
    ↓
eligibility evaluation (Prompt 05)
    ↓
ONE common ranking (Prompt 06)
    ↓
HOPE / PEP classification (Prompt 07) ← this prompt
```

### Classification consumes the live ranking
Classification reads from the existing `StudentRanking` table (live ranking). It does NOT create a frozen ranking or snapshot. Those belong to a future prompt.

### Ranking is NOT modified
Classification is read-only with respect to ranking. It reads `StudentRanking.rank` but never writes to `StudentRanking`. The rank order remains exactly as computed by Prompt 06's ranking engine.

### Classification Logic

The engine walks the live ranking in order (rank 1, 2, 3...) and for each student:

1. Checks eligibility: `hopeEligible` and `pepEligible` flags
2. If the student is HOPE-eligible AND HOPE slots remain (hopeSlotsFilled < hopeCount) → **HOPE**
3. Else if the student is PEP-eligible AND PEP slots remain (pepSlotsFilled < pepCount) → **PEP**
4. Else → **NOT_ELIGIBLE**

Ineligible students do NOT consume HOPE or PEP slots — the engine skips them when counting.

### Eligibility Mapping

The current EligibilityResult model has a single `isEligible: Boolean`. The service maps this to classification inputs:
- `isEligible: true` → `hopeEligible: true, pepEligible: true` (eligible for both programs)
- `isEligible: false` → `hopeEligible: false, pepEligible: false` (not eligible for either)
- No EligibilityResult found → `hopeEligible: false, pepEligible: false` (treated as not eligible)

The classification engine itself accepts separate `hopeEligible`/`pepEligible` flags per student, supporting future eligibility enhancements where HOPE and PEP have different eligibility criteria (PEP-only students).

### Configuration Source

Classification boundaries come from `CycleConfig`:
- `hopeCount: Int` — maximum number of students to classify as HOPE
- `pepCount: Int` — maximum number of students to classify as PEP

No hardcoded values. The institution configures these per cycle.

### Classification Output

Uses the existing `HopePepClassification` Prisma model:
- `program: String` — 'HOPE', 'PEP', or 'NOT_ELIGIBLE'
- `rank: Int` — the student's rank from the common ranking
- `status: ClassificationStatus` — always 'CLASSIFIED' for initial classification
- `snapshotId: String?` — null for live classification (made optional in this prompt)

All students with a ranking are classified (including NOT_ELIGIBLE).

## Schema Change

Made `HopePepClassification.snapshotId` optional:
- `snapshotId String` → `snapshotId String?`
- `snapshot RankingSnapshot` → `snapshot RankingSnapshot?`

This supports live classification (no snapshot) while preserving the field for future snapshot-based classification. The relation uses `onDelete: Restrict` as before.

## Implementation

### Classification Engine (Pure Calculation)

**File**: `apps/api/src/member1/classification/classification.engine.ts`

Pure functions with zero framework/database dependencies:

| Function | Purpose |
|----------|---------|
| `validateClassificationConfig(config)` | Validates hopeCount/pepCount are non-negative integers |
| `classifyStudents(students, config)` | Full classification: sort by rank → walk in order → assign HOPE/PEP/NOT_ELIGIBLE → count results |

**Types exported**: Program, ClassificationInput, ClassificationConfig, ClassifiedStudent, ClassificationCalculationResult

### Classification Service

**File**: `apps/api/src/member1/classification/classification.service.ts`

| Method | Purpose |
|--------|---------|
| `loadClassificationInputs(cycleId)` | Parallel-loads StudentRanking + EligibilityResult, maps to ClassificationInput[] |
| `calculate(cycleId, actorId)` | Full pipeline: validate → audit → load data → classify → persist → audit |
| `getClassifications(cycleId, page, pageSize)` | Paginated query of HopePepClassification ordered by rank |
| `getStudentClassification(studentId, cycleId)` | Single student lookup |

### Classification Controller

**File**: `apps/api/src/member1/classification/classification.controller.ts`

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/classification/calculate` | Calculate/recalculate HOPE/PEP classification from live ranking |
| GET | `/api/classification/:selectionCycleId` | Get classifications for a cycle (paginated) |
| GET | `/api/classification/:selectionCycleId/student/:studentId` | Get classification for a specific student |

### Persistence Strategy

Uses Prisma `$transaction` wrapping upserts on the compound unique key `@@unique([studentId, selectionCycleId])`:
- First calculation: creates HopePepClassification records
- Recalculation: updates existing records (program, rank, status, classifiedAt)
- No duplicate rows possible

### Recalculation

`calculate(selectionCycleId)` is explicitly triggered — NOT automatic. When recalculated:
1. Reload current StudentRanking data
2. Reload current EligibilityResult data
3. Read current CycleConfig (hopeCount, pepCount)
4. Reclassify all students
5. Persist via transactional upserts

Changes to ranking, eligibility, or configuration are reflected in the next explicit classification call.

### Audit Events

| Event | When |
|-------|------|
| `CLASSIFICATION_CALCULATION_STARTED` | Before classification begins (includes hopeCount, pepCount) |
| `CLASSIFICATION_CALCULATION_COMPLETED` | After all classifications persisted (includes totalStudents, hopeClassified, pepClassified, notEligibleCount) |
| `CLASSIFICATION_CALCULATION_FAILED` | If computation throws unexpectedly |

### Contract

Added `ClassificationResultContract` to `apps/api/src/common/contracts/member1.contract.ts`:
```typescript
interface ClassificationResultContract {
  studentId: string;
  selectionCycleId: string;
  program: string;
  rank: number;
  status: string;
  classifiedAt: Date | string;
}
```

## Files Created
- `apps/api/src/member1/classification/classification.engine.ts` — Pure classification engine
- `apps/api/test/classification-engine.spec.ts` — 28 engine tests
- `apps/api/test/classification-service.spec.ts` — 16 service tests
- `logs/PROMPT_07.md` — This log file

## Files Modified
- `apps/api/prisma/schema.prisma` — HopePepClassification.snapshotId made optional (String → String?)
- `apps/api/src/member1/classification/classification.service.ts` — Full implementation replacing stub
- `apps/api/src/member1/classification/classification.controller.ts` — Full implementation replacing stub
- `apps/api/src/member1/classification/classification.dto.ts` — Updated DTOs (CalculateClassificationDto, ClassificationQueryDto, FallbackDecisionDto)
- `apps/api/src/common/contracts/member1.contract.ts` — Added ClassificationResultContract
- `logs/README.md` — Updated log index

## Tests Added

### classification-engine.spec.ts (28 tests)
| Category | Tests |
|----------|-------|
| basic classification | 4 — HOPE-eligible inside boundary → HOPE, outside boundary → PEP, PEP-only → PEP, neither eligible → NOT_ELIGIBLE |
| ranking order | 4 — respects ranking order, skips ineligible for HOPE slots, preserves input ranks, sorts input by rank |
| boundary behavior | 4 — overflow HOPE → PEP, beyond both boundaries → NOT_ELIGIBLE, PEP-only doesn't consume HOPE slot, tied students use existing rank |
| determinism and recalculation | 2 — identical input → identical output, changing boundary changes classification |
| edge cases | 7 — no students, no eligible students, all HOPE-eligible, all PEP-only, hopeCount=0, pepCount=0, both counts zero |
| mixed eligibility population | 1 — interleaved eligible/ineligible/PEP-only students |
| result metadata | 2 — correct counts, preserves eligibility flags |
| config validation | 5 — valid config, zero counts, negative hopeCount, negative pepCount, non-integer counts |

### classification-service.spec.ts (16 tests)
| Category | Tests |
|----------|-------|
| calculate | 11 — missing cycle, missing CycleConfig, no rankings, classification with ranking+eligibility, no eligibility result → NOT_ELIGIBLE, persistence via $transaction, recalculation idempotent, audit started+completed, completed audit metadata, does not modify StudentRanking, changed boundary on recalculation |
| getClassifications | 2 — returns ordered by rank, supports pagination |
| getStudentClassification | 2 — returns classification for student, null when no classification |

## Commands Executed
1. `DATABASE_URL=... npx prisma validate` — PASS
2. `DATABASE_URL=... npx prisma generate` — Regenerated Prisma client after schema change
3. `npx tsc --noEmit -p apps/api/tsconfig.json` — PASS (zero errors)
4. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="(classification|ranking|eligibility|scoring)"` — 211 PASS
5. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="member3"` — 8 PASS

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| classification-engine.spec.ts | 28 | PASS |
| classification-service.spec.ts | 16 | PASS |
| ranking-engine.spec.ts | 33 | PASS |
| ranking-service.spec.ts | 17 | PASS |
| eligibility-engine.spec.ts | 40 | PASS |
| eligibility-service.spec.ts | 30 | PASS |
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| **Total** | **219** | **219 PASS** |

## Failures / Blockers
- **PostgreSQL unavailable**: Cannot run allocation.e2e-spec.ts. Pre-existing constraint.
- **No database integration tests for classification**: Service tests use mocked Prisma. Full integration requires a live database.

## Integration Impact
- **Member 2**: No code changes. Classification adds ClassificationResultContract to member1.contract.ts. No existing contracts modified.
- **Member 3**: No code changes. Member 3 tests pass (8/8).
- **Ranking layer**: No changes. Classification reads StudentRanking.rank (read-only).
- **Eligibility layer**: No changes. Classification reads EligibilityResult.isEligible (read-only).
- **Scoring layer**: No changes.
- **Prisma schema**: HopePepClassification.snapshotId changed from required to optional. This is backward-compatible — existing records with snapshotId values remain valid.

## What Was Intentionally NOT Implemented
- Freeze scheduling
- Freeze execution
- RankingSnapshot creation
- Snapshot entries
- Countdown
- Notifications
- Interview workflow
- HOPE interview failure handling
- PEP fallback after interview (endpoint stub preserved in DTO for future use)
- Final human selection
- Allocation
- AI/advisory logic
- Frontend changes
- Separate HOPE-eligible vs PEP-eligible eligibility rules (single boolean used)
- Competition ranking
- Automatic recalculation on score/eligibility write

## Design Decisions

### Pure Engine Separation
Following the scoring, eligibility, and ranking engine pattern: `classification.engine.ts` contains zero NestJS/Prisma dependencies. All classification logic is pure, deterministic, and independently testable.

### Separate hopeEligible/pepEligible in Engine
The engine accepts separate boolean flags per student rather than a single `isEligible`. This allows:
- Testing all 4 eligibility states (both, HOPE-only, PEP-only, neither)
- Future extensibility when eligibility rules differentiate HOPE vs PEP
- Clean separation of concerns: the service maps from the DB model, the engine classifies

### snapshotId Made Optional
The original schema required `snapshotId` on HopePepClassification, designed for frozen-snapshot-based classification. Since this prompt explicitly requires classification from the live ranking (no snapshot), `snapshotId` was made optional. Future snapshot-based classification will populate it.

### All Students Classified (Including NOT_ELIGIBLE)
All ranked students receive a HopePepClassification record, including NOT_ELIGIBLE. This ensures:
1. Upsert works cleanly for recalculation (no orphaned records)
2. Distinction between "not yet classified" and "classified as not eligible"
3. Complete audit trail

### No Eligibility Modification
Classification does NOT modify EligibilityResult. It reads eligibility as-is and maps to classification inputs. Students without eligibility results are treated as NOT_ELIGIBLE.

### ClassificationStatus = CLASSIFIED for All
All initial classifications get status=CLASSIFIED. The other enum values (HOPE_INTERVIEW_FAILED, PEP_FALLBACK_ALLOWED, PEP_FALLBACK_DENIED) are for the future interview/fallback workflow.

### Existing Deterministic Rank Used for Boundary Ties
When students are tied at a classification boundary, the existing deterministic rank from Prompt 06 (which already resolved ties via studentId) determines who falls inside vs outside the boundary. No new tie-breaking rule was invented.

## Remaining Limitations
- **Single eligibility boolean**: Current EligibilityResult has only `isEligible: Boolean`. Cannot distinguish HOPE-eligible-only vs PEP-eligible-only students. All eligible students are treated as eligible for both programs. The engine supports the distinction; the service mapping needs enhancement when eligibility rules differentiate.
- **No snapshot support**: Classification runs on live ranking only. Snapshot-based classification (from RankingSnapshot) belongs to a future prompt.
- **No interview workflow**: HOPE interview failure → PEP fallback is not implemented.
- **Database integration**: Service tests use mocked Prisma. Full transactional behavior not verified.

## Git Changes
Not yet committed. All changes are on branch `feature/member1-eligibility-ranking`.

## Final Status
COMPLETED

---

## Prompt 07.1 — Schema/Migration Verification

### Date
2026-09-29

### Objective
Verify the Prisma schema change from Prompt 07 (HopePepClassification.snapshotId made optional) and ensure a proper migration exists.

### Schema Change Verified

Confirmed the ONLY Prisma schema change introduced by Prompt 07 is:

```prisma
# Before (Prompt 03 original):
snapshotId          String
snapshot            RankingSnapshot      @relation(...)

# After (Prompt 07):
snapshotId          String?
snapshot            RankingSnapshot?     @relation(...)
```

No other models, enums, fields, or constraints were changed by Prompt 07. The git diff confirms all other schema additions are from Prompt 03 (Member 1 models, enums, and reverse relations).

### Migration Status

**Before this prompt**: One migration existed (`20260929_init`), which created `HopePepClassification` with `"snapshotId" TEXT NOT NULL`. No migration existed for the nullable change. No `migration_lock.toml` existed (migrations never applied to a real database).

**After this prompt**: Created:
1. `apps/api/prisma/migrations/20260929_classification_snapshot_optional/migration.sql` — Contains:
   ```sql
   ALTER TABLE "HopePepClassification" ALTER COLUMN "snapshotId" DROP NOT NULL;
   ```
2. `apps/api/prisma/migrations/migration_lock.toml` — Standard Prisma lock file specifying `provider = "postgresql"`.

### Migration Sequence
1. `20260929_init` → Creates all tables including `HopePepClassification` with `snapshotId TEXT NOT NULL`
2. `20260929_classification_snapshot_optional` → Makes `snapshotId` nullable (`DROP NOT NULL`)

After both migrations apply, the database column matches the current schema: `snapshotId TEXT` (nullable).

### Schema Consistency Verified

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS — schema is valid |
| `npx prisma generate` | PASS — Prisma Client v6.12.0 regenerated |
| `npx tsc --noEmit` | PASS — zero TypeScript errors |
| Generated client matches schema | PASS — `snapshotId` is optional in generated types |

### Classification Behavior Verified

| Check | Result |
|-------|--------|
| Live classification persists `snapshotId = null` | PASS — service never sets snapshotId; Prisma defaults to null |
| Existing snapshot-linked classifications remain valid | PASS — field is nullable, existing non-null values are valid |
| Recalculation still works | PASS — upsert on `@@unique([studentId, selectionCycleId])` |
| StudentRanking remains read-only | PASS — service only calls `studentRanking.findMany`, never writes |
| EligibilityResult remains read-only | PASS — service only calls `eligibilityResult.findMany`, never writes |
| HOPE/PEP counts are configuration-driven | PASS — loaded from `CycleConfig.hopeCount`/`pepCount` |

### Commands Run
1. `npx prisma validate` — PASS
2. `npx prisma generate` — PASS
3. `npx tsc --noEmit -p apps/api/tsconfig.json` — PASS
4. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="(classification|ranking|eligibility|scoring)"` — 211 PASS
5. `npx jest --runInBand --config apps/api/jest.config.cjs --testPathPattern="member3"` — 8 PASS

### Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| classification-engine.spec.ts | 28 | PASS |
| classification-service.spec.ts | 16 | PASS |
| ranking-engine.spec.ts | 33 | PASS |
| ranking-service.spec.ts | 17 | PASS |
| eligibility-engine.spec.ts | 40 | PASS |
| eligibility-service.spec.ts | 30 | PASS |
| scoring-engine.spec.ts | 28 | PASS |
| scoring-service.spec.ts | 19 | PASS |
| member3.e2e-spec.ts | 8 | PASS |
| **Total** | **219** | **219 PASS** |

### PostgreSQL Limitation
PostgreSQL is unavailable. The migration was created but could NOT be applied or verified against a live database. `prisma migrate diff --from-migrations` requires a shadow database, which was also unavailable. The migration SQL (`ALTER COLUMN ... DROP NOT NULL`) is standard PostgreSQL and correct for the change, but database-level verification was not performed.

### Files Created
- `apps/api/prisma/migrations/20260929_classification_snapshot_optional/migration.sql`
- `apps/api/prisma/migrations/migration_lock.toml`

### Files Modified
- `logs/PROMPT_07.md` — This verification section appended

### Prompt 07.1 Status
COMPLETED
