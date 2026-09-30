# Member 1 Architecture — Eligibility, Ranking & Selection Engine

## 1. Scope

Member 1 is the **authoritative decision engine** for the PEP/HOPE Selection, Ranking & Training Allocation platform. It sits between data ingestion (Member 3) and allocation workflow (Member 2), owning every computation that determines whether a student is eligible, how students are ranked, and how they are classified into HOPE or PEP programs.

No other module may implement eligibility evaluation, score calculation, ranking, or HOPE/PEP classification logic. Member 2 and Member 3 consume Member 1's results through defined contracts.

## 2. Responsibilities

| Area | Description |
|------|-------------|
| Eligibility evaluation | Determine per-student eligibility within a selection cycle using configurable rules |
| Score processing | Read raw parameter scores, validate, flag missing data |
| Parameter weighting | Maintain versioned first-year parameter weight configurations |
| Weighted score calculation | Multiply normalized scores by weights, sum to total |
| Common ranking | Rank ALL students in a cycle by total score (single ranking, not split by program) |
| Deterministic tie handling | Resolve ties through a configurable, isolated tie-break strategy |
| Live ranking | Serve the current calculated ranking before freeze |
| Selection cycle configuration | Manage cycle-level settings (weight version, HOPE/PEP boundaries, freeze schedule) |
| Scheduled ranking freeze | Schedule a future freeze; system auto-freezes at that time |
| Frozen ranking snapshots | Capture immutable snapshots preserving all calculation inputs and results |
| Snapshot versioning | Support corrective re-freeze without overwriting previous snapshots |
| HOPE/PEP classification | Assign program groups based on frozen common ranking and configurable boundaries |
| HOPE → PEP fallback | Support admin decision to allow a HOPE interview failure to attempt PEP |
| Member 2 integration | Implement contract interfaces, drive WorkflowState transitions |
| Member 3 integration | Replace demo eligibility, provide authoritative results |
| Audit trail | Log every administrative and computational action |

## 3. Architecture

### 3.1 System Position

```
External Projects (2, 1, 8) / CSV / XLSX
                ↓
      Integration Gateway (Member 3)
      validate → normalize → idempotency
                ↓
      Canonical Student Data → AssessmentResult (Member 2 DB)
                ↓
  ┌─────────────────────────────────────────────┐
  │          MEMBER 1 — DECISION ENGINE         │
  │                                             │
  │  EligibilityService                         │
  │       ↓                                     │
  │  ScoringService (weights × parameters)      │
  │       ↓                                     │
  │  RankingService (single common ranking)     │
  │       ↓                                     │
  │  FreezeService (scheduled snapshot)         │
  │       ↓                                     │
  │  ClassificationService (HOPE / PEP)         │
  │       ↓                                     │
  │  WorkflowIntegration (state transitions)    │
  └─────────────────────────────────────────────┘
                ↓
      StudentCycleStatus = SELECTION (Member 2)
                ↓
      Allocation Workflow (Member 2)
                ↓
      Advisory AI + Reports (Member 3)
```

### 3.2 Data Flow — Full Pipeline

```
1. Admin creates/activates SelectionCycle
2. Admin configures parameter weights → WeightVersion v1
3. Students imported via Member 3 → Student + AssessmentResult records
4. Admin triggers eligibility evaluation
   → EligibilityResult per student (eligible / ineligible + reasons)
   → StudentCycleStatus transitions to ELIGIBILITY
5. Admin triggers score calculation (explicit action)
   → StudentScore per student per parameter
   → StudentRanking per student (total score, rank, percentile)
   → Live ranking available
6. Admin may change weights → WeightVersion v2 created
   → Live ranking UNCHANGED until explicit recalculation
7. Admin triggers recalculation with v2
   → New StudentScore + StudentRanking computed
8. Admin schedules ranking freeze for future date/time
   → FreezeSchedule created (status: SCHEDULED)
9. System auto-freezes at scheduled time
   → RankingSnapshot created (version 1)
   → RankingSnapshotEntry per student (all inputs + outputs preserved)
   → FreezeSchedule status → EXECUTED
10. ClassificationService runs on frozen snapshot
    → HOPE group (top N by rank)
    → PEP group (next M by rank)
    → StudentCycleStatus transitions to HOPE_PEP
11. Students advanced to SELECTION state
    → Member 2 allocation workflow begins
12. If correction needed on frozen data:
    → New snapshot version created, previous preserved
```

## 4. Module Structure

```
apps/api/src/
├── member1/
│   ├── member1.module.ts              NestJS module registration
│   │
│   ├── eligibility/
│   │   ├── eligibility.service.ts     Rule evaluation engine
│   │   ├── eligibility.controller.ts  REST endpoints
│   │   └── eligibility.dto.ts         Request/response validation
│   │
│   ├── scoring/
│   │   ├── scoring.service.ts         Weighted score calculation
│   │   └── scoring.dto.ts             Validation
│   │
│   ├── ranking/
│   │   ├── ranking.service.ts         Ranking computation + live queries
│   │   ├── ranking.controller.ts      REST endpoints
│   │   └── ranking.dto.ts             Validation
│   │
│   ├── classification/
│   │   ├── classification.service.ts  HOPE/PEP grouping
│   │   ├── classification.controller.ts  REST endpoints
│   │   └── classification.dto.ts      Validation
│   │
│   ├── freeze/
│   │   ├── freeze.service.ts          Scheduling + snapshot creation
│   │   ├── freeze.controller.ts       REST endpoints
│   │   ├── freeze.scheduler.ts        Cron/timer that triggers freeze
│   │   └── freeze.dto.ts              Validation
│   │
│   ├── weights/
│   │   ├── weights.service.ts         Weight CRUD + versioning
│   │   ├── weights.controller.ts      REST endpoints
│   │   └── weights.dto.ts             Validation
│   │
│   ├── cycle/
│   │   ├── cycle.service.ts           Cycle config + orchestration
│   │   ├── cycle.controller.ts        REST endpoints
│   │   └── cycle.dto.ts               Validation
│   │
│   └── audit/
│       └── audit.service.ts           Centralized audit logging
```

### 4.1 Module Dependency Map

| Module | Responsibility | Reads From | Writes To | Communicates With |
|--------|---------------|------------|-----------|-------------------|
| **cycle** | Cycle config, orchestration | SelectionCycle | SelectionCycle, CycleConfig | weights, eligibility, ranking, freeze |
| **weights** | Weight CRUD, versioning | WeightVersion, ParameterWeight | WeightVersion, ParameterWeight | scoring (provides active version) |
| **eligibility** | Rule evaluation | Student, AssessmentResult, EligibilityRule | EligibilityResult, StudentCycleStatus | Member 2 (state transition), audit |
| **scoring** | Weighted calculation | AssessmentResult, ParameterWeight, WeightVersion | StudentScore | ranking (provides computed scores) |
| **ranking** | Rank computation, live queries | StudentScore | StudentRanking | freeze (provides data for snapshot) |
| **classification** | HOPE/PEP grouping | RankingSnapshot/StudentRanking, CycleConfig | HopePepClassification, StudentCycleStatus | Member 2 (state transition) |
| **freeze** | Schedule, snapshot, versioning | StudentRanking, StudentScore, ParameterWeight, WeightVersion | FreezeSchedule, RankingSnapshot, RankingSnapshotEntry | classification (triggers after freeze) |
| **audit** | Logging | — | ScoreAuditLog, WorkflowAuditLog | All modules call audit |

## 5. Data Flow Diagrams

### 5.1 Scoring Pipeline

```
AssessmentResult (raw scores per parameter)
        ↓
  [Validate: present? in range?]
        ↓
  Flag missing data (isMissing = true, value treated as 0)
        ↓
  Raw Score per parameter
        ↓
  [Optional normalization step — configurable, initially passthrough]
        ↓
  Normalized Score
        ×
  Parameter Weight (from active WeightVersion)
        =
  Weighted Parameter Score
        ↓
  Sum all weighted parameter scores
        =
  Total Score (stored in StudentRanking)
```

### 5.2 Ranking Pipeline

```
All StudentRanking records for a cycle
        ↓
  Sort descending by totalScore
        ↓
  [Tie? → invoke TieBreakStrategy]
        ↓
  Assign rank (1, 2, 3, ...)
        ↓
  Compute percentile (optional)
        ↓
  Store: rank, totalScore, percentile, weightVersionId, calculatedAt
```

### 5.3 Freeze Pipeline

```
FreezeSchedule (status: SCHEDULED, scheduledAt: future timestamp)
        ↓
  Timer/cron checks every minute
        ↓
  When now >= scheduledAt:
        ↓
  1. Read current live StudentRanking for cycle
  2. Read all StudentScore records
  3. Read active WeightVersion + ParameterWeight
  4. Read EligibilityResult per student
  5. Create RankingSnapshot (version 1 for this cycle, or version N+1 if correction)
  6. Create RankingSnapshotEntry per student:
     - studentId, all 12 parameter scores, weights, weighted values
     - totalScore, rank, eligibilityStatus, timestamp
  7. Update FreezeSchedule status → EXECUTED
  8. Trigger ClassificationService
  9. Audit log: RANKING_FROZEN
```

## 6. Database Design

### 6.1 Existing Models (REUSE — do not recreate)

| Model | Owner | Member 1 Usage |
|-------|-------|---------------|
| Student | Member 2 | FK target for all Member 1 per-student records |
| SelectionCycle | Member 2 | FK target for all Member 1 per-cycle records |
| StudentCycleStatus | Member 2 | Member 1 updates `currentState` field |
| AssessmentResult | Member 2 | Member 1 reads raw scores |
| Program | Member 2 | Member 1 references for HOPE/PEP program IDs |
| WorkflowAuditLog | Member 2 | Member 1 writes audit entries for state transitions |
| Domain | Member 2 | Reference for capacity |
| TrainingBatch | Member 2 | Reference for capacity |

### 6.2 Proposed New Models

All models below use UUIDs as primary keys (`@id @default(uuid())`), consistent with the existing schema convention.

---

#### CycleConfig

Cycle-level configuration owned by Member 1, linked 1:1 to SelectionCycle.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle, unique | One config per cycle |
| activeWeightVersionId | String? | FK → WeightVersion, nullable | Currently active weight version for calculations |
| hopeCount | Int | | Configurable number of students in HOPE group |
| pepCount | Int | | Configurable number of students in PEP group |
| eligibilityRuleVersionId | String? | FK → EligibilityRuleVersion, nullable | Active eligibility rule set |
| createdAt | DateTime | default(now()) | |
| updatedAt | DateTime | @updatedAt | |

**Indexes**: `@@unique([selectionCycleId])`
**Relationships**: belongsTo SelectionCycle, belongsTo WeightVersion (optional), hasMany via cycle

---

#### EligibilityRuleVersion

Versioned set of eligibility rules. Rules are stored as structured JSON to allow configuration without code changes.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle | |
| version | Int | | Monotonically increasing per cycle |
| rules | Json | | Array of rule definitions (parameter, operator, threshold) |
| description | String? | | Human-readable description of changes |
| createdBy | String | | Actor who created this version |
| isActive | Boolean | default(false) | Only one active per cycle |
| createdAt | DateTime | default(now()) | |

**Indexes**: `@@unique([selectionCycleId, version])`, `@@index([selectionCycleId, isActive])`
**Lifecycle**: Created on admin action. Previous versions preserved. `isActive` toggled.

---

#### EligibilityResult

Per-student eligibility evaluation output.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| studentId | String | FK → Student | |
| selectionCycleId | String | FK → SelectionCycle | |
| ruleVersionId | String | FK → EligibilityRuleVersion | Which rule set was applied |
| isEligible | Boolean | | Pass/fail result |
| failedRules | Json? | | Array of { ruleKey, expected, actual, message } |
| evaluatedAt | DateTime | default(now()) | |

**Indexes**: `@@unique([studentId, selectionCycleId])`, `@@index([selectionCycleId, isEligible])`
**Lifecycle**: Upserted on each evaluation run. Old result overwritten (audit log preserves history).

---

#### WeightVersion

Versioned parameter weight configuration.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle | |
| version | Int | | Monotonically increasing per cycle |
| description | String? | | Admin notes on this version |
| createdBy | String | | Actor who created |
| createdAt | DateTime | default(now()) | |
| weights | ParameterWeight[] | hasMany | Individual parameter weights |

**Indexes**: `@@unique([selectionCycleId, version])`, `@@index([selectionCycleId])`
**Lifecycle**: Never deleted or overwritten. New versions are appended. CycleConfig.activeWeightVersionId points to the one used for calculations.

---

#### ParameterWeight

Individual parameter weight within a WeightVersion.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| weightVersionId | String | FK → WeightVersion | |
| parameterKey | String | | Machine-readable parameter identifier |
| parameterLabel | String | | Human-readable display name |
| weight | Float | | Multiplier for this parameter |
| maxRawScore | Float | | Maximum possible raw score (for normalization reference) |
| sortOrder | Int | | Display ordering |

**Indexes**: `@@unique([weightVersionId, parameterKey])`
**Lifecycle**: Created with the WeightVersion. Immutable after creation (edit = new version).

---

#### StudentScore

Computed score per student per parameter per cycle calculation run.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| studentId | String | FK → Student | |
| selectionCycleId | String | FK → SelectionCycle | |
| weightVersionId | String | FK → WeightVersion | Which weight config was used |
| parameterKey | String | | Matches ParameterWeight.parameterKey |
| rawScore | Float | | Original score from AssessmentResult |
| isMissing | Boolean | default(false) | True if score was not available (treated as 0) |
| normalizedScore | Float | | After normalization (initially same as rawScore if no normalization) |
| weight | Float | | Weight applied (copied from ParameterWeight at calc time) |
| weightedScore | Float | | normalizedScore × weight |
| calculatedAt | DateTime | default(now()) | |

**Indexes**: `@@unique([studentId, selectionCycleId, weightVersionId, parameterKey])`, `@@index([selectionCycleId, weightVersionId])`
**Lifecycle**: Upserted on each calculation run. Overwritten by recalculation.

---

#### StudentRanking

Computed ranking per student per cycle.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| studentId | String | FK → Student | |
| selectionCycleId | String | FK → SelectionCycle | |
| weightVersionId | String | FK → WeightVersion | |
| totalScore | Float | | Sum of all weightedScores |
| rank | Int | | Position (1 = highest) |
| percentile | Float? | | Optional percentile |
| tieBreakApplied | Boolean | default(false) | Whether tie-breaking was used for this student |
| calculatedAt | DateTime | default(now()) | |

**Indexes**: `@@unique([studentId, selectionCycleId])`, `@@index([selectionCycleId, rank])`, `@@index([selectionCycleId, totalScore])`
**Lifecycle**: Upserted on each ranking calculation. Represents the current LIVE ranking.

---

#### FreezeSchedule

Admin-scheduled ranking freeze.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle | |
| scheduledAt | DateTime | | When the freeze should execute |
| status | FreezeStatus | | SCHEDULED / EXECUTED / CANCELLED / POSTPONED |
| executedAt | DateTime? | | When freeze actually ran |
| snapshotId | String? | FK → RankingSnapshot, nullable | Created snapshot |
| scheduledBy | String | | Actor |
| cancelledBy | String? | | Actor who cancelled/postponed |
| cancelReason | String? | | Reason for cancellation |
| createdAt | DateTime | default(now()) | |
| updatedAt | DateTime | @updatedAt | |

**Enum FreezeStatus**: `SCHEDULED`, `EXECUTED`, `CANCELLED`, `POSTPONED`

**Indexes**: `@@index([selectionCycleId, status])`, `@@index([scheduledAt, status])`
**Lifecycle**: Created by admin. Status updated by scheduler or admin action.

---

#### RankingSnapshot

Immutable frozen ranking snapshot.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle | |
| version | Int | | Snapshot version within cycle (1, 2, ... for corrections) |
| weightVersionId | String | FK → WeightVersion | Weight config used |
| ruleVersionId | String? | FK → EligibilityRuleVersion | Eligibility rules applied |
| hopeCount | Int | | HOPE boundary used at freeze time |
| pepCount | Int | | PEP boundary used at freeze time |
| totalStudents | Int | | Total students in snapshot |
| frozenAt | DateTime | default(now()) | |
| frozenBy | String | | Actor or 'SYSTEM' for scheduled |
| reason | String? | | Reason (for corrections: why re-frozen) |
| entries | RankingSnapshotEntry[] | hasMany | |

**Indexes**: `@@unique([selectionCycleId, version])`, `@@index([selectionCycleId])`
**Lifecycle**: Created at freeze time. NEVER modified after creation. Corrections create version N+1.

---

#### RankingSnapshotEntry

Individual student entry within a frozen snapshot. Contains ALL data needed to reproduce the ranking.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| snapshotId | String | FK → RankingSnapshot | |
| studentId | String | FK → Student | |
| rank | Int | | Rank at freeze time |
| totalScore | Float | | Total weighted score |
| percentile | Float? | | Percentile at freeze time |
| parameterScores | Json | | Full array of { parameterKey, rawScore, isMissing, normalizedScore, weight, weightedScore } |
| isEligible | Boolean | | Eligibility status at freeze |
| eligibilityFailures | Json? | | Failed rules if any |
| program | String? | | 'HOPE', 'PEP', or null if outside both groups |
| tieBreakApplied | Boolean | default(false) | |

**Indexes**: `@@unique([snapshotId, studentId])`, `@@index([snapshotId, rank])`, `@@index([snapshotId, program])`
**Lifecycle**: Created with the snapshot. NEVER modified.

---

#### HopePepClassification

Per-student program classification result.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| studentId | String | FK → Student | |
| selectionCycleId | String | FK → SelectionCycle | |
| snapshotId | String | FK → RankingSnapshot | Which snapshot determined this |
| program | String | | 'HOPE' or 'PEP' |
| rank | Int | | Student's rank in the common ranking |
| status | ClassificationStatus | | CLASSIFIED / HOPE_INTERVIEW_FAILED / PEP_FALLBACK_ALLOWED / PEP_FALLBACK_DENIED |
| adminDecisionBy | String? | | Actor who made fallback decision |
| adminDecisionAt | DateTime? | | When fallback decision was made |
| adminDecisionReason | String? | | Reason for fallback decision |
| classifiedAt | DateTime | default(now()) | |
| updatedAt | DateTime | @updatedAt | |

**Enum ClassificationStatus**: `CLASSIFIED`, `HOPE_INTERVIEW_FAILED`, `PEP_FALLBACK_ALLOWED`, `PEP_FALLBACK_DENIED`

**Indexes**: `@@unique([studentId, selectionCycleId])`, `@@index([selectionCycleId, program])`, `@@index([selectionCycleId, status])`
**Lifecycle**: Created during classification. Updated only for HOPE→PEP fallback admin decisions.

---

#### ScoreAuditLog

Member 1-specific audit trail for scoring/ranking operations. Complements (does not replace) Member 2's WorkflowAuditLog.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, uuid | |
| selectionCycleId | String | FK → SelectionCycle | |
| action | String | | e.g. WEIGHT_VERSION_CREATED, ELIGIBILITY_EVALUATED, RANKING_CALCULATED, FREEZE_SCHEDULED, RANKING_FROZEN, SNAPSHOT_CORRECTED, CLASSIFICATION_COMPLETED, HOPE_PEP_FALLBACK, RECALCULATION_REQUESTED |
| actor | String | | Who triggered the action |
| role | String? | | Actor's role |
| entityType | String? | | e.g. WeightVersion, RankingSnapshot, EligibilityResult |
| entityId | String? | | ID of the affected entity |
| previousValue | Json? | | State before change |
| newValue | Json? | | State after change |
| reason | String? | | Admin-provided reason |
| metadata | Json? | | Additional context |
| createdAt | DateTime | default(now()) | |

**Indexes**: `@@index([selectionCycleId, action])`, `@@index([selectionCycleId, createdAt])`, `@@index([entityType, entityId])`
**Lifecycle**: Append-only. Never modified or deleted.

---

### 6.3 New Enums Required

```prisma
enum FreezeStatus {
  SCHEDULED
  EXECUTED
  CANCELLED
  POSTPONED
}

enum ClassificationStatus {
  CLASSIFIED
  HOPE_INTERVIEW_FAILED
  PEP_FALLBACK_ALLOWED
  PEP_FALLBACK_DENIED
}
```

### 6.4 Entity Relationship Summary

```
SelectionCycle (Member 2)
    ├── CycleConfig (1:1)
    │       ├── → WeightVersion (active)
    │       └── → EligibilityRuleVersion (active)
    ├── WeightVersion (1:many)
    │       └── ParameterWeight (1:many)
    ├── EligibilityRuleVersion (1:many)
    ├── EligibilityResult (1:many, per student)
    ├── StudentScore (1:many, per student × parameter)
    ├── StudentRanking (1:many, per student)
    ├── FreezeSchedule (1:many)
    ├── RankingSnapshot (1:many, versioned)
    │       └── RankingSnapshotEntry (1:many, per student)
    ├── HopePepClassification (1:many, per student)
    └── ScoreAuditLog (1:many)

Student (Member 2)
    ├── EligibilityResult (1:many across cycles)
    ├── StudentScore (1:many)
    ├── StudentRanking (1:many)
    ├── RankingSnapshotEntry (1:many)
    └── HopePepClassification (1:many)
```

## 7. Scoring Design

### 7.1 Calculation Pipeline

```
For each student in the cycle:
  For each parameter defined in the active WeightVersion:
    1. Locate the raw score
       Source: AssessmentResult where studentId matches and
               assessmentType/sourceIdentifier maps to parameterKey
       If not found → rawScore = 0, isMissing = true
    2. Normalize (configurable step)
       Default: normalizedScore = rawScore (passthrough)
       Future: normalizedScore = (rawScore / maxRawScore) × 100
       The normalization function is isolated so it can be swapped
       without rewriting downstream logic
    3. Apply weight
       weightedScore = normalizedScore × weight
    4. Store StudentScore record

  totalScore = SUM(all weightedScore for this student)
  Store StudentRanking with totalScore
```

### 7.2 Normalization Strategy

Normalization is **optional and configurable**. The scoring engine includes a normalization step that defaults to passthrough. This allows:

- Initial deployment with raw scores (if all parameters share a common scale)
- Future activation of normalization (if parameters have different scales)

The normalization function signature:

```typescript
normalize(rawScore: number, maxRawScore: number, config?: NormalizationConfig): number
```

Default implementation: `return rawScore`

This is NOT an open decision — it is an architectural provision. The actual normalization formula, if ever needed, IS an open decision.

### 7.3 Score Data Quality

| Scenario | Handling |
|----------|---------|
| Score present and in range | Use as-is |
| Score present but out of range | Validation error, block calculation |
| Score missing (no AssessmentResult) | rawScore = 0, isMissing = true, weightedScore = 0 |
| Genuine zero vs missing | Distinguished by `isMissing` flag on StudentScore |

### 7.4 Service Interface

```typescript
interface ScoringService {
  calculateScores(selectionCycleId: string, weightVersionId: string): Promise<{
    studentsProcessed: number;
    scoresCreated: number;
    missingDataFlags: number;
  }>;

  getStudentScores(studentId: string, selectionCycleId: string): Promise<StudentScore[]>;
}
```

## 8. Eligibility Design

### 8.1 Separation from Ranking

Eligibility is evaluated BEFORE ranking. A student who is not eligible may still appear in ranking data (for transparency), but their eligibility status is tracked separately.

Eligibility does NOT determine rank position — it determines whether a student proceeds through the workflow.

### 8.2 Rule Engine

Eligibility rules are stored as structured data in EligibilityRuleVersion.rules (JSON). Each rule specifies:

```json
{
  "ruleKey": "min_coding_score",
  "parameterKey": "codingScore",
  "operator": "GTE",
  "threshold": 70,
  "message": "Coding score must be at least 70"
}
```

Supported operators: `GTE` (>=), `LTE` (<=), `GT` (>), `LT` (<), `EQ` (==), `NEQ` (!=), `EXISTS` (non-null check), `MIN_COUNT` (array length check).

The rule engine evaluates ALL rules for each student and returns the complete list of failures, not just the first one.

### 8.3 Service Interface

```typescript
interface EligibilityService {
  evaluateCycle(selectionCycleId: string): Promise<{
    total: number;
    eligible: number;
    ineligible: number;
    results: EligibilityResultContract[];
  }>;

  evaluateStudent(studentId: string, selectionCycleId: string): Promise<EligibilityResultContract>;

  getResults(selectionCycleId: string): Promise<EligibilityResult[]>;

  getStudentResult(studentId: string, selectionCycleId: string): Promise<EligibilityResult | null>;
}
```

### 8.4 Workflow Integration

After eligibility evaluation:
1. For each eligible student → update StudentCycleStatus.currentState to `ELIGIBILITY`
2. Write WorkflowAuditLog entry for each transition
3. Write ScoreAuditLog entry for the batch evaluation

## 9. Ranking Design

### 9.1 Single Common Ranking

There is ONE ranking for ALL students in a selection cycle. Students are NOT separated into HOPE and PEP pools before ranking. The common ranking is the input to HOPE/PEP classification, not the output.

### 9.2 Ranking Algorithm

```
1. Retrieve all StudentRanking.totalScore for the cycle
2. Sort descending by totalScore
3. For students with equal totalScore → invoke TieBreakStrategy
4. Assign sequential rank starting from 1
5. Compute percentile: ((totalStudents - rank) / totalStudents) × 100
6. Persist rank and percentile to StudentRanking
```

### 9.3 Tie-Break Strategy

The tie-break mechanism is **isolated behind a strategy interface**:

```typescript
interface TieBreakStrategy {
  compare(a: TieBreakInput, b: TieBreakInput): number;
}

interface TieBreakInput {
  studentId: string;
  totalScore: number;
  parameterScores: Map<string, number>;
  metadata: Record<string, unknown>;
}
```

The default implementation uses a configurable ordered list of parameter keys as secondary sort criteria. The exact hierarchy is an **OPEN DECISION** — the architecture ensures any business rule can be plugged in.

### 9.4 Service Interface

```typescript
interface RankingService {
  calculateRanking(selectionCycleId: string): Promise<{
    studentsRanked: number;
    tiesResolved: number;
    weightVersionId: string;
    calculatedAt: Date;
  }>;

  getLiveRanking(selectionCycleId: string, options?: {
    page?: number;
    pageSize?: number;
    program?: string;
  }): Promise<{ rankings: StudentRanking[]; total: number }>;

  getStudentRanking(studentId: string, selectionCycleId: string): Promise<StudentRanking | null>;
}
```

## 10. HOPE/PEP Classification Design

### 10.1 Classification Logic

Input: Frozen common ranking (from RankingSnapshot) + CycleConfig (hopeCount, pepCount)

```
Sorted students by rank (ascending, rank 1 first):
  Students ranked 1 through hopeCount → program = 'HOPE'
  Students ranked (hopeCount+1) through (hopeCount + pepCount) → program = 'PEP'
  Students ranked beyond (hopeCount + pepCount) → program = null (not classified)
```

The values `hopeCount` and `pepCount` are stored in CycleConfig and are **fully configurable** per cycle. No hardcoded values.

### 10.2 Students Outside Both Groups

Students ranked beyond the HOPE + PEP boundary are assigned `program = null` in HopePepClassification with status `CLASSIFIED`. They are not eligible for either program's interview process under the current configuration. They remain visible in rankings and reports.

### 10.3 HOPE → PEP Fallback

If a HOPE student fails their one-to-one interview (determined outside this system), an admin can update their classification:

```
HopePepClassification.status: CLASSIFIED → HOPE_INTERVIEW_FAILED
    ↓ (admin decision)
HopePepClassification.status: PEP_FALLBACK_ALLOWED or PEP_FALLBACK_DENIED
```

This is an explicit admin action, NOT automatic. The service records:
- Who made the decision
- When
- Why (reason text)

### 10.4 Workflow Integration

After classification:
1. For each classified student → update StudentCycleStatus.currentState to `HOPE_PEP`
2. After admin confirms readiness → advance to `SELECTION` (enabling Member 2's allocation)
3. Write audit entries for all transitions

### 10.5 Service Interface

```typescript
interface ClassificationService {
  classifyFromSnapshot(snapshotId: string): Promise<{
    hopeCount: number;
    pepCount: number;
    unclassified: number;
  }>;

  getClassification(selectionCycleId: string): Promise<HopePepClassification[]>;

  getStudentClassification(studentId: string, selectionCycleId: string): Promise<HopePepClassification | null>;

  recordHopeInterviewFailure(studentId: string, selectionCycleId: string): Promise<HopePepClassification>;

  decideFallback(studentId: string, selectionCycleId: string, decision: {
    allow: boolean;
    actorId: string;
    role: string;
    reason: string;
  }): Promise<HopePepClassification>;
}
```

## 11. Freeze Design

### 11.1 Freeze Lifecycle

```
Admin schedules freeze
    → FreezeSchedule { status: SCHEDULED, scheduledAt: 2026-10-15T10:00:00Z }
    → Students/dashboard can see: "Ranking freezes in X days, Y hours"

Timer ticks (checked every 60 seconds by freeze.scheduler.ts)
    → Finds FreezeSchedule where scheduledAt <= now AND status = SCHEDULED
    → Executes freeze:
        1. Lock: prevent concurrent execution
        2. Read live ranking
        3. Read all StudentScore records
        4. Read active WeightVersion + ParameterWeight
        5. Read EligibilityResult per student
        6. Create RankingSnapshot with version number
        7. Create RankingSnapshotEntry per student with full data
        8. Update FreezeSchedule.status → EXECUTED, executedAt = now
        9. Run ClassificationService.classifyFromSnapshot()
       10. Audit: RANKING_FROZEN

Admin may cancel/postpone before execution:
    → FreezeSchedule.status → CANCELLED or POSTPONED
    → Audit log entry with reason
```

### 11.2 Countdown API

```typescript
GET /api/selection-cycles/:id/freeze-schedule
→ {
    id, scheduledAt, status,
    countdown: { days, hours, minutes, seconds },
    scheduledBy, createdAt
  }
```

### 11.3 Snapshot Immutability

After a RankingSnapshot is created:
- Its entries are NEVER modified
- Later data imports (Project 2 updates) affect only the LIVE ranking, not the frozen snapshot
- The live ranking may diverge from the frozen snapshot — this is by design

### 11.4 Correction Re-Freeze

If a critical error requires updating a frozen snapshot:

```
Admin requests correction
    → Must provide reason
    → New RankingSnapshot created with version = previous.version + 1
    → Previous snapshot preserved (queryable by version)
    → Audit: SNAPSHOT_CORRECTED with reason and both version IDs
```

### 11.5 Service Interface

```typescript
interface FreezeService {
  schedule(selectionCycleId: string, input: {
    scheduledAt: Date;
    scheduledBy: string;
  }): Promise<FreezeSchedule>;

  cancel(freezeScheduleId: string, input: {
    cancelledBy: string;
    reason: string;
  }): Promise<FreezeSchedule>;

  postpone(freezeScheduleId: string, input: {
    newScheduledAt: Date;
    postponedBy: string;
    reason: string;
  }): Promise<FreezeSchedule>;

  executeFreezeNow(selectionCycleId: string, frozenBy: string): Promise<RankingSnapshot>;

  getSchedule(selectionCycleId: string): Promise<FreezeSchedule | null>;

  getSnapshots(selectionCycleId: string): Promise<RankingSnapshot[]>;

  getSnapshot(snapshotId: string): Promise<RankingSnapshot & { entries: RankingSnapshotEntry[] }>;

  correctSnapshot(snapshotId: string, input: {
    correctedBy: string;
    reason: string;
  }): Promise<RankingSnapshot>;
}
```

## 12. Weight Versioning

### 12.1 Lifecycle

```
Admin creates first weight configuration for a cycle
    → WeightVersion { version: 1, selectionCycleId }
    → 12× ParameterWeight records created
    → CycleConfig.activeWeightVersionId → this version
    → Audit: WEIGHT_VERSION_CREATED

Admin edits weights
    → WeightVersion { version: 2 } created (version 1 untouched)
    → New 12× ParameterWeight records
    → CycleConfig.activeWeightVersionId → version 2
    → RANKING IS NOT RECALCULATED
    → Audit: WEIGHT_VERSION_CREATED

Admin explicitly clicks "Recalculate"
    → ScoringService.calculateScores(cycleId, weightVersionId=2)
    → RankingService.calculateRanking(cycleId)
    → New StudentScore and StudentRanking records computed with version 2
    → Audit: RECALCULATION_REQUESTED, RANKING_CALCULATED
```

### 12.2 Referential Integrity

- Every StudentScore record references the WeightVersion used
- Every StudentRanking record references the WeightVersion used
- Every RankingSnapshot record references the WeightVersion used
- Historical versions are never deleted

### 12.3 Service Interface

```typescript
interface WeightsService {
  createVersion(selectionCycleId: string, input: {
    weights: Array<{ parameterKey: string; parameterLabel: string; weight: number; maxRawScore: number; sortOrder: number }>;
    description?: string;
    createdBy: string;
  }): Promise<WeightVersion>;

  getActiveVersion(selectionCycleId: string): Promise<WeightVersion & { weights: ParameterWeight[] }>;

  getVersionHistory(selectionCycleId: string): Promise<WeightVersion[]>;

  getVersion(weightVersionId: string): Promise<WeightVersion & { weights: ParameterWeight[] }>;
}
```

## 13. Member 2 Integration

### 13.1 Contract Implementation

Member 1 implements and populates the contracts defined in `apps/api/src/common/contracts/member1.contract.ts`:

| Contract | Populated By | When |
|----------|-------------|------|
| EligibilityResultContract | EligibilityService.evaluateCycle() | After eligibility evaluation |
| RankingResultContract | RankingService.calculateRanking() | After ranking calculation |
| SelectionResultContract | ClassificationService + workflow | After HOPE/PEP classification and selection advancement |
| CapacityConfigContract | Read from Domain + TrainingBatch | On demand |

### 13.2 Workflow State Transitions

Member 1 drives these transitions on StudentCycleStatus.currentState:

| Transition | Trigger | Member 1 Action |
|------------|---------|-----------------|
| IMPORTED → ELIGIBILITY | Admin triggers eligibility evaluation | EligibilityService updates status for eligible students |
| ELIGIBILITY → HOPE_PEP | Admin triggers classification after freeze | ClassificationService updates status |
| HOPE_PEP → SELECTION | Admin confirms readiness | CycleService advances eligible+classified students |

Each transition:
1. Updates StudentCycleStatus.currentState
2. Writes a WorkflowAuditLog entry (using Member 2's model)
3. Writes a ScoreAuditLog entry (Member 1's own audit)

### 13.3 SelectionResultContract Population

When a student reaches SELECTION state:

```typescript
{
  studentId: student.id,
  selectionCycleId: cycle.id,
  selected: true,                    // selected for program
  programCode: classification.program, // 'HOPE' or 'PEP'
  rank: ranking.rank,
  score: ranking.totalScore,
  decisionReference: snapshot.id,    // links to the frozen snapshot
  evaluatedAt: classification.classifiedAt,
  criteriaSummary: {
    weightVersionId: snapshot.weightVersionId,
    snapshotVersion: snapshot.version,
    eligibilityRuleVersionId: snapshot.ruleVersionId,
  }
}
```

### 13.4 Data Flow to Member 2

```
Member 1 runs eligibility → sets StudentCycleStatus to ELIGIBILITY
Member 1 runs ranking + freeze + classification → sets to HOPE_PEP
Member 1 advances → sets to SELECTION
Member 2 reads students where currentState = 'SELECTION'
Member 2 calls allocation.generate()
Member 2 allocation references Member 1 snapshot via selectionResultReference
```

## 14. Member 3 Integration

### 14.1 Replacement Points

| Member 3 Location | Current Behavior | Member 1 Replacement |
|-------------------|-----------------|---------------------|
| demo.service.ts:evaluateEligibility() | Hardcoded thresholds, sets interviewEligible | Call EligibilityService.evaluateCycle() |
| demo.service.ts:status() | Lists MEMBER_1_RULE_ENGINE as missing | Remove from missing list when Member 1 is active |
| intelligence.service.ts:whatIf() | Duplicated eligibility checks | Call EligibilityService.evaluateStudent() with projected scores |
| reports.service.ts:eligibilityFailures() | Duplicated eligibility checks | Read from EligibilityResult table |
| agent.service.ts:run() | Filters by interviewEligible flag | Read from EligibilityResult table |

### 14.2 Integration Boundary

Member 3 should consume Member 1 through:

1. **Direct service injection** (recommended for same-process NestJS): Member 3 services import Member1Module and inject EligibilityService/RankingService
2. **REST API** (alternative for future service separation): Member 3 calls Member 1 HTTP endpoints

For the current monolithic NestJS application, direct service injection is preferred.

### 14.3 Event-Driven Hook

Member 3's README mentions subscribing to `student.eligibility.recalculated` events. The implementation approach:

- Member 1 emits a NestJS event (using EventEmitter2 or a simple callback) after eligibility evaluation
- Member 3 can subscribe to update its in-memory store if still using it
- This is a future enhancement — initial integration uses direct service calls

### 14.4 DEMO_MODE Preservation

When `DEMO_MODE=true` and Member 1 services are not yet active:
- demo.service.ts fallback continues to work as before
- When Member 1 is active, demo.service.ts should delegate to Member 1 instead of using hardcoded rules
- The demo flag boundary is preserved; no demo logic leaks into Member 1

## 15. API Contracts

### 15.1 Selection Cycle Management

**POST /api/selection-cycles**
- Purpose: Create a new selection cycle
- Auth: ADMIN, COORDINATOR
- Body: `{ code: string, name: string, academicPeriod: string, startDate: ISO8601, endDate: ISO8601, hopeCount: number, pepCount: number }`
- Response 201: `{ id, code, name, ... }`
- Errors: 400 (validation), 409 (duplicate code)

**GET /api/selection-cycles**
- Purpose: List all cycles
- Auth: Any authenticated
- Query: `?status=ACTIVE`
- Response 200: `SelectionCycle[]`

**GET /api/selection-cycles/:id**
- Purpose: Get cycle details including config
- Auth: Any authenticated
- Response 200: `{ ...cycle, config: CycleConfig, activeWeights: WeightVersion }`
- Errors: 404

**PATCH /api/selection-cycles/:id**
- Purpose: Update cycle settings (hopeCount, pepCount, status)
- Auth: ADMIN, COORDINATOR
- Body: `{ hopeCount?: number, pepCount?: number, status?: CycleStatus }`
- Response 200: Updated cycle
- Errors: 400, 404

### 15.2 Weight Management

**POST /api/selection-cycles/:id/weights**
- Purpose: Create a new weight version
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Body: `{ weights: [{ parameterKey, parameterLabel, weight, maxRawScore, sortOrder }], description? }`
- Response 201: `{ weightVersion, message: "Weight version created. Recalculation required to apply." }`
- Errors: 400 (validation — e.g. wrong number of parameters), 404 (cycle not found)

**GET /api/selection-cycles/:id/weights**
- Purpose: Get active weight configuration
- Auth: Any authenticated
- Response 200: `{ weightVersion, weights: ParameterWeight[] }`
- Errors: 404

**GET /api/selection-cycles/:id/weights/history**
- Purpose: List all weight versions
- Auth: ADMIN, COORDINATOR
- Response 200: `WeightVersion[]`

**GET /api/selection-cycles/:id/weights/:versionId**
- Purpose: Get specific weight version with parameter details
- Auth: ADMIN, COORDINATOR
- Response 200: `{ weightVersion, weights: ParameterWeight[] }`
- Errors: 404

### 15.3 Eligibility

**POST /api/selection-cycles/:id/evaluate**
- Purpose: Trigger eligibility evaluation for all students in cycle
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Response 201: `{ total, eligible, ineligible, ruleVersionId, evaluatedAt }`
- Errors: 404 (cycle), 400 (no active rule version)

**GET /api/selection-cycles/:id/eligibility**
- Purpose: Get all eligibility results for cycle
- Auth: ADMIN, COORDINATOR, PEP_STAFF
- Query: `?isEligible=true|false&page=1&pageSize=50`
- Response 200: `{ results: EligibilityResult[], total, page, pageSize }`

**GET /api/selection-cycles/:id/eligibility/:studentId**
- Purpose: Get individual student eligibility
- Auth: Any authenticated (students see own result)
- Response 200: `EligibilityResult`
- Errors: 404

### 15.4 Ranking

**POST /api/selection-cycles/:id/calculate**
- Purpose: Calculate/recalculate scores and rankings using active weight version
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Response 201: `{ studentsProcessed, studentsRanked, tiesResolved, weightVersionId, calculatedAt }`
- Errors: 404, 400 (no active weight version)

**GET /api/selection-cycles/:id/rankings**
- Purpose: Get current live rankings
- Auth: Any authenticated
- Query: `?page=1&pageSize=50&search=<name or id>`
- Response 200: `{ rankings: StudentRanking[], total, page, pageSize, weightVersionId, calculatedAt }`

**GET /api/selection-cycles/:id/rankings/:studentId**
- Purpose: Get individual student ranking
- Auth: Any authenticated
- Response 200: `{ ranking: StudentRanking, scores: StudentScore[] }`
- Errors: 404

**POST /api/selection-cycles/:id/recalculate**
- Purpose: Explicit admin-triggered full recalculation (eligibility + scores + ranking)
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ reason: string }`
- Response 201: `{ eligibility: {...}, scoring: {...}, ranking: {...} }`

### 15.5 Classification

**POST /api/selection-cycles/:id/classify**
- Purpose: Run HOPE/PEP classification from the latest frozen snapshot
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Response 201: `{ hopeCount, pepCount, unclassified, snapshotId }`
- Errors: 400 (no frozen snapshot), 404

**GET /api/selection-cycles/:id/classification**
- Purpose: Get all HOPE/PEP classifications
- Auth: Any authenticated
- Query: `?program=HOPE|PEP`
- Response 200: `HopePepClassification[]`

**GET /api/selection-cycles/:id/classification/:studentId**
- Purpose: Get individual classification
- Auth: Any authenticated
- Response 200: `HopePepClassification`
- Errors: 404

**POST /api/selection-cycles/:id/classification/:studentId/hope-failure**
- Purpose: Record that a HOPE student failed their interview
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Response 200: Updated HopePepClassification

**POST /api/selection-cycles/:id/classification/:studentId/fallback-decision**
- Purpose: Admin decides whether HOPE failure student can attempt PEP
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ allow: boolean, reason: string }`
- Response 200: Updated HopePepClassification

### 15.6 Freeze Management

**POST /api/selection-cycles/:id/freeze-schedule**
- Purpose: Schedule a future ranking freeze
- Auth: ADMIN, COORDINATOR
- Header: x-actor-id required
- Body: `{ scheduledAt: ISO8601 }`
- Validation: scheduledAt must be in the future
- Response 201: `FreezeSchedule`
- Errors: 400 (past date, already scheduled), 404

**GET /api/selection-cycles/:id/freeze-schedule**
- Purpose: Get current freeze schedule with countdown
- Auth: Any authenticated
- Response 200: `{ ...schedule, countdown: { days, hours, minutes, seconds } }`
- Errors: 404 (no schedule)

**POST /api/selection-cycles/:id/freeze-schedule/cancel**
- Purpose: Cancel scheduled freeze
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ reason: string }`
- Response 200: Updated FreezeSchedule
- Errors: 400 (already executed)

**POST /api/selection-cycles/:id/freeze-schedule/postpone**
- Purpose: Postpone to new date
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ newScheduledAt: ISO8601, reason: string }`
- Response 200: New FreezeSchedule

**POST /api/selection-cycles/:id/freeze**
- Purpose: Execute immediate freeze (bypass schedule)
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ reason?: string }`
- Response 201: RankingSnapshot

### 15.7 Snapshots

**GET /api/selection-cycles/:id/snapshots**
- Purpose: List all frozen snapshots for cycle
- Auth: ADMIN, COORDINATOR, PEP_STAFF
- Response 200: `RankingSnapshot[]` (without entries)

**GET /api/selection-cycles/:id/snapshots/:snapshotId**
- Purpose: Get snapshot with all entries
- Auth: ADMIN, COORDINATOR, PEP_STAFF
- Query: `?page=1&pageSize=50&program=HOPE|PEP`
- Response 200: `{ snapshot: RankingSnapshot, entries: RankingSnapshotEntry[], total }`

**POST /api/selection-cycles/:id/snapshots/:snapshotId/correct**
- Purpose: Create corrective re-freeze
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ reason: string }`
- Response 201: New RankingSnapshot with incremented version

### 15.8 Audit

**GET /api/selection-cycles/:id/audit**
- Purpose: Get Member 1 audit trail
- Auth: ADMIN, COORDINATOR
- Query: `?action=RANKING_FROZEN&page=1&pageSize=50`
- Response 200: `{ entries: ScoreAuditLog[], total }`

### 15.9 Eligibility Rules Management

**POST /api/selection-cycles/:id/eligibility-rules**
- Purpose: Create new eligibility rule version
- Auth: ADMIN
- Header: x-actor-id required
- Body: `{ rules: [{ ruleKey, parameterKey, operator, threshold, message }], description? }`
- Response 201: EligibilityRuleVersion

**GET /api/selection-cycles/:id/eligibility-rules**
- Purpose: Get active eligibility rule set
- Auth: ADMIN, COORDINATOR
- Response 200: EligibilityRuleVersion with rules

**GET /api/selection-cycles/:id/eligibility-rules/history**
- Purpose: List all eligibility rule versions
- Auth: ADMIN
- Response 200: EligibilityRuleVersion[]

## 16. Audit Strategy

### 16.1 Dual Audit Approach

| Audit System | Owner | Purpose | Used By Member 1 |
|-------------|-------|---------|-------------------|
| WorkflowAuditLog | Member 2 | Workflow state transitions | Yes — for StudentCycleStatus transitions |
| ScoreAuditLog | Member 1 | Scoring/ranking/configuration operations | Yes — for all Member 1 operations |

### 16.2 Audited Actions

| Action Key | Trigger | Data Captured |
|-----------|---------|---------------|
| WEIGHT_VERSION_CREATED | Admin creates weight config | cycleId, versionId, parameter count, createdBy |
| ELIGIBILITY_RULES_CREATED | Admin creates rule set | cycleId, ruleVersionId, rule count, createdBy |
| ELIGIBILITY_EVALUATED | Admin triggers evaluation | cycleId, total, eligible, ineligible, ruleVersionId |
| SCORES_CALCULATED | Scoring service runs | cycleId, weightVersionId, studentsProcessed, missingFlags |
| RANKING_CALCULATED | Ranking service runs | cycleId, studentsRanked, tiesResolved, weightVersionId |
| RECALCULATION_REQUESTED | Admin requests full recalculation | cycleId, reason, actor |
| FREEZE_SCHEDULED | Admin schedules freeze | cycleId, scheduledAt, scheduledBy |
| FREEZE_CANCELLED | Admin cancels freeze | cycleId, freezeId, reason, cancelledBy |
| FREEZE_POSTPONED | Admin postpones freeze | cycleId, oldDate, newDate, reason |
| RANKING_FROZEN | System executes freeze | cycleId, snapshotId, version, studentCount |
| SNAPSHOT_CORRECTED | Admin creates correction | cycleId, oldSnapshotId, newSnapshotId, reason |
| CLASSIFICATION_COMPLETED | Classification runs | cycleId, snapshotId, hopeCount, pepCount |
| HOPE_PEP_FALLBACK | Admin decides on HOPE failure | studentId, cycleId, decision, reason |
| CYCLE_CONFIG_UPDATED | Admin changes hopeCount/pepCount | cycleId, previousValue, newValue |
| STUDENTS_ADVANCED | Students moved to next state | cycleId, count, fromState, toState |

### 16.3 Audit Fields

Every ScoreAuditLog entry includes:
- **who**: actor ID + role
- **what**: action key + entityType + entityId
- **when**: createdAt timestamp
- **change**: previousValue + newValue (JSON)
- **why**: reason (required for corrections, cancellations, fallback decisions)
- **context**: selectionCycleId + metadata

## 17. Test Strategy

### 17.1 Scoring Tests

| Test | Description |
|------|-------------|
| Valid 12 parameter scores | All parameters present, correct weighted total |
| Single missing parameter | isMissing flag set, treated as 0, total adjusted |
| Multiple missing parameters | All flagged, total reflects only available scores |
| Out-of-range score | Validation error thrown |
| Weight version isolation | Changing weights does not change existing StudentScore records |
| Recalculation with new weights | New scores computed with new weights, old scores preserved in audit |

### 17.2 Ranking Tests

| Test | Description |
|------|-------------|
| Simple ranking (no ties) | Students ordered by descending total score |
| Ranking with ties | Same total score produces deterministic order |
| Single student | Rank = 1 |
| Large pool | Correct ranking for 500+ students |
| Percentile calculation | Correct percentile values |
| Recalculation produces new ranking | Old ranking overwritten, audit entry created |

### 17.3 Weight Version Tests

| Test | Description |
|------|-------------|
| Create first version | Version 1 created, set as active |
| Create second version | Version 2 created, version 1 preserved |
| Active version tracking | CycleConfig points to correct active version |
| Weight change does NOT recalculate | Live ranking unchanged after weight update |
| Explicit recalculation uses new version | Ranking computed with version 2 weights |
| Historical version queryable | Version 1 still retrievable |

### 17.4 Freeze Tests

| Test | Description |
|------|-------------|
| Schedule future freeze | FreezeSchedule created with SCHEDULED status |
| Reject past date | 400 error for scheduledAt in the past |
| Cancel scheduled freeze | Status → CANCELLED with reason |
| Postpone freeze | New schedule created with new date |
| Execute freeze | Snapshot created, all entries populated |
| Snapshot immutability | New data import does not change frozen snapshot entries |
| Live ranking diverges | After freeze, live ranking updates independently |
| Corrective re-freeze | New snapshot version, previous preserved |

### 17.5 HOPE/PEP Tests

| Test | Description |
|------|-------------|
| Configurable HOPE count | Top N students assigned HOPE |
| Configurable PEP count | Next M students assigned PEP |
| Students beyond boundary | Not classified (program = null) |
| No hardcoded 150/350 | Boundary values come from CycleConfig |
| HOPE interview failure | Status updated correctly |
| PEP fallback allowed | Admin decision recorded, status updated |
| PEP fallback denied | Admin decision recorded, status updated |

### 17.6 Eligibility Tests

| Test | Description |
|------|-------------|
| All rules pass | Student marked eligible |
| One rule fails | Student marked ineligible with failure details |
| Multiple rules fail | All failures listed |
| Rule version isolation | Changing rules does not change existing results |
| Missing score handling | Missing treated as 0, may trigger eligibility failure |

### 17.7 Integration Tests

| Test | Description |
|------|-------------|
| EligibilityResultContract shape | Output matches Member 2 contract interface |
| RankingResultContract shape | Output matches Member 2 contract interface |
| SelectionResultContract shape | Output matches Member 2 contract interface |
| StudentCycleStatus transition | Status correctly updated through ELIGIBILITY → HOPE_PEP → SELECTION |
| WorkflowAuditLog entries | Audit entries written for each transition |
| Member 3 eligibility replacement | EligibilityService returns same contract as demo.service expected |

### 17.8 Audit Tests

| Test | Description |
|------|-------------|
| Weight creation logged | ScoreAuditLog entry exists |
| Recalculation logged | Entry with reason and actor |
| Freeze logged | Entry with snapshot details |
| Correction logged | Entry with old and new snapshot versions |

## 18. Open Business Decisions

| # | Decision | Impact | Blocking? |
|---|----------|--------|-----------|
| 1 | Exact 12 parameter names/keys | Cannot create real ParameterWeight records | No — architecture supports any set of parameter keys |
| 2 | Default weight values | Cannot seed initial WeightVersion | No — admin creates first version |
| 3 | Parameter score ranges (normalization) | Normalization step is passthrough until decided | No |
| 4 | Exact eligibility rules | Cannot seed EligibilityRuleVersion | No — admin creates rules at runtime |
| 5 | Tie-break hierarchy | Default tie-break may not match business intent | No — strategy is pluggable |
| 6 | Privacy/name visibility in rankings | API returns full data; display filtering is frontend concern | No |
| 7 | Snapshot retention period | All snapshots kept indefinitely until decided | No |
| 8 | Notification provider for freeze countdown | No notification system designed | No — countdown is a query API |
| 9 | Normalization formula (if needed) | Passthrough used until decided | No |
| 10 | dsaLevel → numeric mapping | Needed if dsaLevel is one of the 12 parameters | Partially — depends on #1 |

## 19. Implementation Phases

### Phase 1: Schema + Core Services
- Add Member 1 models to Prisma schema
- Implement PrismaService integration
- WeightsService (CRUD, versioning)
- EligibilityService (rule engine)
- ScoringService (calculation pipeline)
- RankingService (ranking + tie handling)
- AuditService (centralized logging)
- Member1Module registration

### Phase 2: Freeze + Classification
- FreezeService (schedule, execute, snapshot)
- FreezeScheduler (cron/timer)
- ClassificationService (HOPE/PEP grouping)
- Snapshot creation and query

### Phase 3: Controllers + API Layer
- CycleController
- WeightsController
- EligibilityController
- RankingController
- ClassificationController
- FreezeController
- DTO validation classes

### Phase 4: Integration
- Member 2 contract implementation
- StudentCycleStatus state transitions
- WorkflowAuditLog integration
- Member 3 integration boundary (service injection)

### Phase 5: Tests + Frontend
- E2E tests for all API endpoints
- Unit tests for scoring/ranking logic
- Integration tests with Member 2/3 data
- Frontend dashboard components

## 20. Files Expected to Be Created/Modified

### New Files (Member 1)
```
apps/api/src/member1/member1.module.ts
apps/api/src/member1/eligibility/eligibility.service.ts
apps/api/src/member1/eligibility/eligibility.controller.ts
apps/api/src/member1/eligibility/eligibility.dto.ts
apps/api/src/member1/scoring/scoring.service.ts
apps/api/src/member1/scoring/scoring.dto.ts
apps/api/src/member1/ranking/ranking.service.ts
apps/api/src/member1/ranking/ranking.controller.ts
apps/api/src/member1/ranking/ranking.dto.ts
apps/api/src/member1/classification/classification.service.ts
apps/api/src/member1/classification/classification.controller.ts
apps/api/src/member1/classification/classification.dto.ts
apps/api/src/member1/freeze/freeze.service.ts
apps/api/src/member1/freeze/freeze.controller.ts
apps/api/src/member1/freeze/freeze.scheduler.ts
apps/api/src/member1/freeze/freeze.dto.ts
apps/api/src/member1/weights/weights.service.ts
apps/api/src/member1/weights/weights.controller.ts
apps/api/src/member1/weights/weights.dto.ts
apps/api/src/member1/cycle/cycle.service.ts
apps/api/src/member1/cycle/cycle.controller.ts
apps/api/src/member1/cycle/cycle.dto.ts
apps/api/src/member1/audit/audit.service.ts
apps/api/test/member1.e2e-spec.ts
```

### Modified Files
```
apps/api/prisma/schema.prisma          (add Member 1 models + enums)
apps/api/src/app.module.ts             (register Member1Module)
apps/web/src/main.tsx                  (add Member 1 dashboard section)
```

### Files NOT Modified
```
apps/api/src/controllers.ts            (Member 3 — not touched)
apps/api/src/domain.ts                 (Member 3 — not touched)
apps/api/src/store.ts                  (Member 3 — not touched)
apps/api/src/integrations.service.ts   (Member 3 — not touched)
apps/api/src/ai.service.ts             (Member 3 — not touched)
apps/api/src/agent.service.ts          (Member 3 — not touched initially)
apps/api/src/demo.service.ts           (Member 3 — not touched initially)
apps/api/src/intelligence.service.ts   (Member 3 — not touched initially)
apps/api/src/reports.service.ts        (Member 3 — not touched initially)
apps/api/src/allocation/*              (Member 2 — not touched)
```

---

## Member 2 Selection Result Integration

### Overview

Member 1 exposes a clean selection-result boundary that Member 2 consumes to obtain the deterministic output of the ranking/classification/freeze pipeline. Member 1 does NOT perform allocation, interviews, or final human selection.

### Authoritative Source Resolution

Member 1 applies fail-closed authority resolution:

| Cycle State | Authority | Source |
|-------------|-----------|--------|
| No executed freeze | Live ranking + live classification | `LIVE` |
| Executed freeze + valid snapshot | Immutable RankingSnapshot | `SNAPSHOT` |
| Executed freeze + null snapshotId | **Error** (ConflictException) | N/A |
| Executed freeze + snapshot missing | **Error** (NotFoundException) | N/A |

Once a freeze is executed, Member 1 never silently falls back to live data.

### Selection-Result Endpoint

```
GET /api/selection/:selectionCycleId/results
```

Returns an array of `SelectionResultContract` for the cycle, using the authoritative source.

```
GET /api/selection/:selectionCycleId/results/:studentId
```

Returns a single `SelectionResultContract` for one student, or `null` if the student has no result yet.

### SelectionResultContract Fields

```typescript
{
  studentId: string;
  selectionCycleId: string;
  selected: boolean;           // true = HOPE or PEP, false = NOT_ELIGIBLE
  programCode: string;         // 'HOPE' | 'PEP' | 'NOT_ELIGIBLE'
  rank?: number;               // rank in common ranking
  score?: number;              // total weighted score
  decisionReference: string;   // deterministic reference — see below
  evaluatedAt: Date | string;  // timestamp of classification
  source?: 'LIVE' | 'SNAPSHOT'; // which source produced this result
  snapshotId?: string;         // populated when source = SNAPSHOT
  snapshotVersion?: number;    // populated when source = SNAPSHOT
}
```

All optional fields are omitted for backward compatibility where Member 2 consumers do not need them.

### DecisionReference Format

The `decisionReference` is deterministic and reproducible from the result itself:

- **LIVE**: `SEL:<selectionCycleId>:<studentId>:LIVE`
- **SNAPSHOT**: `SEL:<selectionCycleId>:<studentId>:SNAP:<snapshotId>:v<snapshotVersion>`

It does not use random values or timestamps as the only identity.

### LIVE vs SNAPSHOT Behavior

**Before freeze (LIVE):**
- `source: 'LIVE'`
- rank and score from live `StudentRanking`
- program from live `HopePepClassification`
- `snapshotId` and `snapshotVersion` omitted

**After freeze (SNAPSHOT):**
- `source: 'SNAPSHOT'`
- rank, score, and `programCode` derived exclusively from `RankingSnapshotEntry` — no `HopePepClassification`, no `StudentRanking`, no `StudentScore`, no `EligibilityResult` is queried
- `evaluatedAt` = `RankingSnapshot.frozenAt` (the moment the snapshot was taken)
- `snapshotId` = the authoritative snapshot ID
- `snapshotVersion` = the snapshot version number
- Live ranking data is **never** read as a fallback

### What Member 2 Is Responsible For

Member 2 owns:
- `StudentCycleStatus` transitions (SELECTION, ALLOCATED, etc.)
- Allocation workflow and capacity management
- Interview scheduling and results
- Final human selection decisions
- Notification delivery to students

Member 2 should NOT re-implement eligibility evaluation, ranking, or HOPE/PEP classification.

### What Member 1 Is NOT Responsible For

- Interview decisions
- Final human selection
- Allocation
- StudentCycleStatus state transitions (beyond what already exists in P07/P08)
- Notification delivery

### Expected Member 2 Consumption Flow

1. Member 2 identifies the selection cycle ID.
2. Member 2 calls `GET /api/selection/:selectionCycleId/results`.
3. Member 2 reads `source` to confirm whether the result is LIVE or SNAPSHOT.
4. For frozen cycles, Member 2 uses `snapshotId` and `snapshotVersion` as audit references.
5. Member 2 uses `programCode` (HOPE/PEP/NOT_ELIGIBLE) and `rank` for its own workflow logic.
6. Member 2 calls `GET /api/classification/:selectionCycleId/authority` to check freeze status independently.
7. Member 2 performs its own workflow transitions — Member 1 does not mutate Member 2 state.

### No Direct Member 2 State Mutation

`SelectionResultService` is **read-only**. It does not:
- Mutate `RankingSnapshot` or `RankingSnapshotEntry`
- Recalculate ranking as a side effect
- Change classification records
- Trigger `StudentCycleStatus` transitions

---

## 19. Prompt 13 Hardening — Frozen Selection Result Source Isolation

**Date:** 2026-09-29

### Issue Found

The original `buildFrozenResults` and `buildFrozenStudentResult` implementations queried `HopePepClassification` as the primary data source for `programCode` and `evaluatedAt`, using `RankingSnapshotEntry.program` only as a fallback. This violated the design invariant that the frozen path must read solely from the immutable snapshot tables.

### Correction Applied

Both frozen methods were rewritten to:

1. Fetch `RankingSnapshot` and `RankingSnapshotEntry` in parallel (`Promise.all`).
2. Derive `programCode` directly from `entry.program` — `HopePepClassification` is never queried.
3. Use `snapshot.frozenAt` as `evaluatedAt` — no secondary timestamp source needed.
4. The following tables are **never queried** in the frozen path: `HopePepClassification`, `StudentRanking`, `StudentScore`, `EligibilityResult`.

### selected Field Semantics (Documented)

`selected: true` means the student was **classified into HOPE or PEP during the ranking engine run**. It does NOT mean the student passed a final human interview or was formally admitted. Final human selection is a Member 2 concern.

### Test Coverage Added (hardening)

| Test | Assertion |
|------|-----------|
| `programCode comes from RankingSnapshotEntry.program, not HopePepClassification` | `findMany` and `findUnique` on `hopePepClassification` not called |
| `frozen result does not query HopePepClassification.findMany` | Explicit spy assertion |
| `frozen result does not query StudentRanking` | `findMany` and `findUnique` on `studentRanking` not called |
| `frozen single-student result does not query HopePepClassification` | Covers `getStudentSelectionResult` frozen path |
| `selected=true for HOPE/PEP entry from snapshot` | Correct semantics from entry |
| `selected=false for NOT_ELIGIBLE entry from snapshot` | Correct semantics from entry |
| `broken frozen state still fails closed (Conflict/NotFound)` | Fail-closed preserved |
| `incomplete snapshot still throws BadRequestException` | Completeness check preserved |

Total: 46 tests in `selection-result.spec.ts` (was 36 before hardening).
Full regression after hardening: 451 pass, 11 pre-existing Member 2 allocation failures (require live PostgreSQL).

---

## 20. Critical Update / Re-Freeze with Versioned Snapshots (Prompt 14)

**Date:** 2026-09-29

### Overview

Once a ranking freeze has been executed the immutable snapshot is permanently preserved. If an authorized administrator determines that a critical correction is required (e.g., a ranking calculation error was discovered after freeze), a re-freeze may be issued. The re-freeze creates a **new snapshot version** while leaving all previous versions completely intact.

### Versioning

Snapshots are versioned monotonically per selection cycle:

```
snapshot v1   (initial freeze)
→ critical re-freeze
→ snapshot v2
→ critical re-freeze
→ snapshot v3
```

The `RankingSnapshot` table enforces `@@unique([selectionCycleId, version])`. Duplicate version creation is blocked at the database level, making concurrent re-freeze races safe.

### What Re-Freeze Does

1. **Requires** an existing executed freeze. Rejects cycles that have not yet been frozen.
2. **Resolves** the current authoritative snapshot for audit context.
3. **Reads current live state**: `StudentRanking`, `StudentScore`, `EligibilityResult`.
4. **Re-classifies** students using `CycleConfig.hopeCount` / `CycleConfig.pepCount` and the classification engine.
5. **In a single transaction**:
   - Creates new `RankingSnapshot` (version = latest + 1) with current state and fresh classification
   - Creates new `RankingSnapshotEntry` records
   - Creates new `FreezeSchedule` with `status = 'EXECUTED'`, `executedAt = now`, `snapshotId = new snapshot`
   - Upserts `HopePepClassification` records to reference the new snapshot
6. **Logs** `REFREEZE_STARTED`, `REFREEZE_COMPLETED` (or `REFREEZE_FAILED`) audit events.

### Authority After Re-Freeze

`ClassificationService.resolveSelectionAuthority()` is the sole authority resolver. It queries `FreezeSchedule` ordered by `executedAt DESC`. After re-freeze, the new EXECUTED schedule (with a more recent `executedAt`) is returned automatically — no changes to the authority resolver are needed.

```
Before re-freeze:
  resolveSelectionAuthority → FreezeSchedule(executedAt=T1, snapshotId=S1) → source=SNAPSHOT, snapshotVersion=1

After re-freeze:
  resolveSelectionAuthority → FreezeSchedule(executedAt=T2, snapshotId=S2) → source=SNAPSHOT, snapshotVersion=2
```

There is never a silent fallback to LIVE when an executed freeze exists.

### Immutability Guarantee

| Invariant | Mechanism |
|-----------|-----------|
| Old snapshot never modified | No UPDATE on `RankingSnapshot` rows; old entries are never touched |
| Old entries never deleted | `RankingSnapshotEntry` cascade DELETE only if snapshot is deleted (never done) |
| Old FreezeSchedule preserved | Re-freeze creates a new schedule; old schedule is not updated |
| Historical reproducibility | Any snapshot version can be queried by ID via `/api/snapshot/:cycleId/:snapshotId` |

### SelectionResult After Re-Freeze

`SelectionResultService` reads exclusively from the snapshot entries. After re-freeze:

- `source = 'SNAPSHOT'`
- `snapshotVersion = 2` (or whatever the new version is)
- rank, score, programCode, evaluatedAt all from the new snapshot entries
- Live tables (`StudentRanking`, `HopePepClassification`) are never read in the frozen path

### Failure / Rollback Behavior

If the transaction fails (DB error, unique constraint violation, etc.):
- The old snapshot remains valid and unmodified
- The old EXECUTED FreezeSchedule remains the authority
- No partial new snapshot is committed
- `REFREEZE_FAILED` audit event is logged with the previous snapshot info

### API

```
POST /api/freeze/:selectionCycleId/refreeze
Header: x-actor-id: <actor>
Body: { reason?: string }

Response:
{
  snapshotId: string,       // new snapshot ID
  version: number,          // new version number
  previousSnapshotId: string,
  previousVersion: number,
  studentCount: number,
  hopeCount: number,
  pepCount: number
}
```

### Schema Changes

None. The existing schema already supports:
- Multiple snapshots per cycle via `@@unique([selectionCycleId, version])`
- Multiple EXECUTED `FreezeSchedule` rows per cycle
- All necessary data relationships

### Files Changed

| File | Change |
|------|--------|
| `apps/api/src/member1/freeze/freeze.service.ts` | Added `refreeze()` method |
| `apps/api/src/member1/freeze/freeze.dto.ts` | Added `RefreezeDto` |
| `apps/api/src/member1/freeze/freeze.controller.ts` | Added `POST :selectionCycleId/refreeze` endpoint |
| `apps/api/test/refreeze.spec.ts` | 41 new tests |

---

## 21. Weight Version Lifecycle and Explicit Ranking Recalculation (Prompt 15)

### Invariant

Weight version changes **never** trigger automatic ranking recalculation. Ranking recalculation is always **explicit** via `POST /api/ranking/calculate`.

### Weight Version Operations

| Operation | Effect | Does NOT trigger |
|-----------|--------|-----------------|
| `WeightsService.createVersion()` | Creates new immutable `WeightVersion` row (version auto-incremented) | Ranking recalculation, CycleConfig update |
| `WeightsService.activate()` | Updates `CycleConfig.activeWeightVersionId` pointer only | Ranking recalculation, StudentScore update |
| `POST /api/ranking/calculate` | Calls `RankingService.calculate()`, updates `StudentRanking` table | Snapshot creation |

### Immutability Rules

- `WeightVersion` rows are **write-once**: once created, they are never updated or deleted
- `ParameterWeight` rows within a version are likewise immutable
- `StudentScore` rows are keyed by `(studentId, selectionCycleId, weightVersionId, parameterKey)` — old-version scores persist unchanged when a new version is activated
- `StudentRanking` rows are updated **only** by explicit `RankingService.calculate()` calls

### Weight Version Resolution

`RankingService.calculate(cycleId, weightVersionId?, actor)`:
- If `weightVersionId` provided → use it directly (bypasses `CycleConfig`)
- If omitted → reads `CycleConfig.activeWeightVersionId` and uses that version

`ScoringService.calculateStudentScores(...)`:
- Always reads `CycleConfig.activeWeightVersionId` at the time of the call
- Scores stored under the version active **at calculation time**

### Snapshot Isolation from Weight Changes

`WeightsService.createVersion()` and `WeightsService.activate()` make **zero calls** to:
- `rankingSnapshot` table
- `rankingSnapshotEntry` table
- `freezeSchedule` table

`ClassificationService.resolveSelectionAuthority()` reads `FreezeSchedule` and `RankingSnapshot` — it never consults `CycleConfig` or `WeightVersion`. Therefore, changing the active weight version does not affect the frozen authority resolution.

### Lifecycle Flow (post-snapshot weight update)

1. Admin creates new `WeightVersion` with updated parameter weights
2. Admin activates the new version (`CycleConfig.activeWeightVersionId` pointer updated)
3. Admin triggers explicit recalculation (`POST /api/ranking/calculate`) — `StudentRanking` rows updated with new `weightVersionId`
4. Admin triggers re-freeze (`POST /api/freeze/:id/refreeze`) — reads current `StudentRanking` (now reflecting new weights), creates new snapshot version
5. Authority auto-resolves to new snapshot (new EXECUTED `FreezeSchedule` has newer `executedAt`)

### Audit Events

| Event | Trigger |
|-------|---------|
| `WEIGHT_VERSION_CREATED` | `WeightsService.createVersion()` |
| `WEIGHT_VERSION_ACTIVATED` | `WeightsService.activate()` — includes `previousValue` and `newValue` |
| `RANKING_CALCULATION_STARTED` | `RankingService.calculate()` — includes resolved `weightVersionId` |
| `RANKING_CALCULATION_COMPLETED` | After all `StudentRanking` upserts committed |
| `RANKING_CALCULATION_FAILED` | On engine error |
| `RANKING_TIE_RESOLVED` | When at least one tie was broken |

### Files Involved

| File | Role |
|------|------|
| `apps/api/src/member1/weights/weights.service.ts` | createVersion (immutable), activate (pointer only) |
| `apps/api/src/member1/weights/weights.dto.ts` | DTOs for create/activate |
| `apps/api/src/member1/ranking/ranking.service.ts` | calculate(), resolveWeightVersion(), loadStudentScores() |
| `apps/api/src/member1/ranking/ranking.engine.ts` | Pure calculation (no DB) |
| `apps/api/src/member1/scoring/scoring.service.ts` | calculateStudentScores(), loadActiveWeights() |
| `apps/api/test/weight-version-lifecycle.spec.ts` | 22 tests proving lifecycle separation |

---

## 22. Eligibility Rule Version Lifecycle (Prompt 16)

### Invariant

Eligibility rule changes **never** trigger automatic eligibility recalculation, ranking recalculation, or classification recalculation. All recalculation is always **explicit**.

### EligibilityRuleVersion Operations

| Operation | Effect | Does NOT trigger |
|-----------|--------|-----------------|
| `EligibilityService.createRuleVersion()` | Creates new immutable `EligibilityRuleVersion` row (`isActive: false`) | Eligibility recalculation, ranking update, snapshot mutation |
| `EligibilityService.activateRuleVersion()` | Sets `isActive: true` on specified version, `false` on others; updates `CycleConfig.eligibilityRuleVersionId` | Eligibility recalculation, ranking update, snapshot mutation |
| `POST /api/eligibility/evaluate` | Calls `EligibilityService.evaluate()`, updates `EligibilityResult` table | Ranking recalculation, classification recalculation |

### Immutability Rules

- `EligibilityRuleVersion.rules` (the JSON rule config) is **write-once**: once created, the rules are never updated
- `EligibilityResult` rows are keyed by `(studentId, selectionCycleId)` and store `ruleVersionId` — the version that produced each result
- Old eligibility results persist unchanged until explicit `evaluate()` is called
- Concurrent version creation is protected by `@@unique([selectionCycleId, version])` DB constraint

### Rule Version Resolution

`EligibilityService.evaluate(cycleId, ruleVersionId?, actor)`:
- If `ruleVersionId` provided → use it directly (bypasses `CycleConfig`)
- If omitted → reads `CycleConfig.eligibilityRuleVersionId`, falls back to `isActive: true` flag

**Consistency guarantee:** the resolved `ruleVersionId` is fixed for the entire evaluation call — all students in a single `evaluate()` invocation use the same rule version.

### Activation Design Note

`activateRuleVersion()` toggles the `isActive` boolean on `EligibilityRuleVersion` rows (in addition to updating `CycleConfig.eligibilityRuleVersionId`). This does NOT modify the immutable `rules` JSON field. The `isActive` flag is a metadata marker — the actual rule definitions are write-once.

### Snapshot Data

`RankingSnapshotEntry` already stores `isEligible` and `eligibilityFailures` from the time of freeze. `RankingSnapshot.ruleVersionId` records which rule version was active when the snapshot was created (set by FreezeService from `CycleConfig.eligibilityRuleVersionId`).

### Snapshot Isolation from Rule Changes

`EligibilityService.createRuleVersion()` and `activateRuleVersion()` make **zero calls** to:
- `rankingSnapshot` table
- `rankingSnapshotEntry` table
- `eligibilityResult` table (upsert)

`EligibilityService.evaluate()` makes **zero calls** to:
- `rankingSnapshot` table
- `rankingSnapshotEntry` table
- `studentRanking` table
- `hopePepClassification` table

### Lifecycle Flow (post-snapshot eligibility rule update)

1. Admin creates new `EligibilityRuleVersion` v2
2. Admin activates v2 (`CycleConfig.eligibilityRuleVersionId` updated)
3. Admin explicitly recalculates eligibility (`POST /api/eligibility/evaluate`) — `EligibilityResult` rows updated with `ruleVersionId: v2`
4. Frozen snapshot remains unchanged
5. Admin optionally recalculates live classification (`POST /api/classification/calculate`)
6. Admin triggers re-freeze (`POST /api/freeze/:id/refreeze`) — reads current `EligibilityResult` (v2), creates new snapshot
7. New snapshot has `ruleVersionId: v2`, `isEligible` reflects v2 evaluation
8. Authority auto-resolves to new snapshot

### Audit Events

| Event | Trigger |
|-------|---------|
| `ELIGIBILITY_RULE_VERSION_CREATED` | `EligibilityService.createRuleVersion()` |
| `ELIGIBILITY_RULE_VERSION_ACTIVATED` | `EligibilityService.activateRuleVersion()` — includes `previousValue.eligibilityRuleVersionId` (prior active version) and `newValue.eligibilityRuleVersionId` + `newValue.version` |
| `ELIGIBILITY_EVALUATION_STARTED` | `EligibilityService.evaluate()` — includes resolved `ruleVersionId` |
| `ELIGIBILITY_EVALUATION_COMPLETED` | Only logged after successful `$transaction` commit |
| `ELIGIBILITY_EVALUATION_FAILED` | Per-student engine failure (compute phase), or transaction failure (logged with `metadata.phase: 'persist'`) |
| `ELIGIBILITY_RULE_FAILED` | Per-student per-rule failure (compute phase, before any DB write) |
| `ELIGIBILITY_INVALID_RULE_CONFIGURATION` | Stored config fails validation |

### Atomic Evaluation (Prompt 16.1)

`EligibilityService.evaluate()` uses a **two-phase** approach:

**Phase 1 — Compute (no DB writes):**
- For each student: call `assembleStudentContext()` then `evaluateEligibility()` (pure engine)
- Engine failures are caught: log `ELIGIBILITY_EVALUATION_FAILED`, re-throw → `$transaction` never called
- Collect result contracts and upsert operation objects (not yet executed)

**Phase 2 — Persist (atomic):**
- All `EligibilityResult` upserts for the entire evaluation call execute inside a single `prisma.$transaction(upsertOps)`
- If the transaction fails: log `ELIGIBILITY_EVALUATION_FAILED` with `metadata.phase: 'persist'`, re-throw
- `ELIGIBILITY_EVALUATION_COMPLETED` is logged ONLY after successful commit

**Guarantee:** Either all students in a single `evaluate()` call have their results written atomically, or none are written and the previous state remains intact.

**Note:** Context assembly failures (`assembleStudentContext` throwing before the engine is reached) propagate uncaught and do not emit `ELIGIBILITY_EVALUATION_FAILED`. The catch block specifically covers engine (`evaluateEligibility`) failures and transaction failures.

### Files Involved

| File | Role |
|------|------|
| `apps/api/src/member1/eligibility/eligibility.service.ts` | createRuleVersion (immutable), activateRuleVersion (pointer + isActive flag + audit previousValue), evaluate (two-phase atomic) |
| `apps/api/src/member1/eligibility/eligibility.engine.ts` | Pure evaluation function (no DB) |
| `apps/api/src/member1/eligibility/eligibility.controller.ts` | POST /api/eligibility/rules, POST /api/eligibility/rules/activate, POST /api/eligibility/evaluate |
| `apps/api/src/member1/eligibility/eligibility.dto.ts` | DTOs for all three operations |
| `apps/api/test/eligibility-rule-lifecycle.spec.ts` | 30 tests proving lifecycle separation |
| `apps/api/test/eligibility-atomicity.spec.ts` | 16 tests proving two-phase atomicity and activation audit |

---

## 23. Integration Readiness Audit (Prompt 17)

**Date:** 2026-09-30

### Defect Fixed: executeFreeze Missing Empty-Ranking Guard

**Symptom:** `FreezeService.refreeze()` had a guard rejecting execution when students exist but no ranking data is present. `FreezeService.executeFreeze()` was missing the equivalent guard.

**Risk:** Without the guard, the initial freeze could produce a snapshot with 0 entries for a cycle that has students — silently creating an authoritative but empty snapshot.

**Fix:** Added the same empty-ranking guard to `executeFreeze()`:

```typescript
if (rankings.length === 0) {
  const cycleStudentCount = await this.prisma.studentCycleStatus.count({
    where: { selectionCycleId },
  });
  if (cycleStudentCount > 0) {
    throw new BadRequestException(
      'Selection cycle has students but no ranking data exists. Run ranking calculation before freezing.',
    );
  }
}
```

Both `executeFreeze()` and `refreeze()` now have symmetric empty-ranking protection.

### End-to-End Integration Smoke Test

**File:** `apps/api/test/end-to-end-pipeline.spec.ts`

Proves the complete Member 1 pipeline is internally consistent across 15 steps:

| Step | What is proved |
|------|---------------|
| 1-2 | Scoring produces per-parameter rows with all required fields |
| 3 | Eligibility evaluates all students with one ruleVersionId (atomic) |
| 4 | Ranking covers ALL students including ineligible; ranks are sequential |
| 5 | Classification assigns HOPE/PEP from live ranking and eligibility |
| 6 | Before freeze → `source = 'LIVE'`, `decisionReference` contains `:LIVE` |
| 7a | executeFreeze rejects when students exist but ranking is empty |
| 7b | executeFreeze creates a versioned snapshot with all required fields |
| 8 | After freeze → `source = 'SNAPSHOT'`, `snapshotVersion = 1` |
| 9 | Live data change does NOT alter frozen snapshot v1 |
| 10 | Re-freeze creates snapshot v2 with updated live data |
| 11 | Snapshot v1 entries are unchanged after re-freeze |
| 12 | After re-freeze, latest executed schedule (v2) is authoritative |
| 13 | Selection results after re-freeze show v2 snapshot data |
| 14 | Authority fails closed when executed freeze has no snapshotId (P12.1) |
| 15 | Frozen selection never mixes frozen rank with live score |

### Full Audit Findings

| Area | Status |
|------|--------|
| Schema completeness | No gaps — all required fields present |
| Module registration | Member1Module correctly imported in AppModule |
| Two-phase eligibility evaluation | Correct — proven by 16 atomicity tests |
| executeFreeze empty-ranking guard | **FIXED** — was missing, now symmetric with refreeze |
| Fail-closed authority (P12.1) | Correct — null snapshotId → ConflictException, no silent LIVE fallback |
| Frozen path reads only snapshot entries | Correct — no live table reads in SelectionResultService frozen path |
| Deterministic ranking | Correct — DefaultTieBreakStrategy uses studentId as final tie-break |
| Snapshot immutability | Correct — no UPDATE on existing RankingSnapshot rows |
| Weight/eligibility version lifecycle | Correct — no auto-recalculation |
| API/contract consistency | Correct — all endpoints wired, contracts match |
| DB migration safety | Correct — no breaking changes in P17 |
| Audit consistency | Correct — all events consistent after P16.1 previousValue fix |

### Files Changed (P17)

| File | Change |
|------|--------|
| `apps/api/src/member1/freeze/freeze.service.ts` | Added empty-ranking guard to `executeFreeze()` |
| `apps/api/test/freeze-service.spec.ts` | Added `studentCycleStatus.count` mock; 2 new guard tests |
| `apps/api/test/end-to-end-pipeline.spec.ts` | Created: 15-step integration smoke test |
| `docs/MEMBER_1_ARCHITECTURE.md` | This section |
| `logs/PROMPT_17.md` | Full audit log |
| `logs/README.md` | Added P17 entry |
