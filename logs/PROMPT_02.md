# Prompt 02

## Prompt Given
Design the complete Member 1 architecture, contracts, and implementation blueprint. Create docs/MEMBER_1_ARCHITECTURE.md covering module structure, data model, scoring pipeline, eligibility engine, ranking engine, HOPE/PEP classification, freeze system, weight versioning, Member 2 and Member 3 integration, API contracts, audit strategy, and test strategy. Do NOT implement any code — documentation and logs only.

## Objective
Produce a comprehensive architecture document that serves as the implementation blueprint for all future Member 1 prompts. Establish data models, service interfaces, API contracts, and integration boundaries so that implementation can proceed with clear specifications.

## Previous Findings Used
- Repository structure from Prompt 01 (monorepo: apps/api NestJS, apps/web React+Vite, services/ai FastAPI)
- Member 2 contract interfaces from `apps/api/src/common/contracts/member1.contract.ts` (SelectionResultContract, EligibilityResultContract, CapacityConfigContract, RankingResultContract)
- Member 2 Prisma schema with 25+ models including Student, SelectionCycle, StudentCycleStatus, WorkflowState enum, AssessmentResult, Program, WorkflowAuditLog
- Member 2 WorkflowState: IMPORTED → ELIGIBILITY → HOPE_PEP → COMMUNICATION → INTERVIEW → SELECTION → ALLOCATION → ADMIN_REVIEW → FINALIZED → FROZEN
- Member 3 demo eligibility duplicated in 3 places (demo.service.ts, intelligence.service.ts, reports.service.ts)
- Member 3 lists MEMBER_1_RULE_ENGINE as missing dependency
- Existing API conventions: NestJS controllers with /api prefix, class-validator DTOs, Swagger decorators, x-role header for authorization
- Database: PostgreSQL via Prisma, UUID primary keys, @default(now()) timestamps, @updatedAt

## Architecture Designed

### Module Structure
```
apps/api/src/member1/
├── member1.module.ts
├── eligibility/   (rule engine, evaluation)
├── scoring/       (weighted calculation pipeline)
├── ranking/       (common ranking, tie handling)
├── classification/ (HOPE/PEP grouping)
├── freeze/        (scheduling, snapshots, versioning)
├── weights/       (parameter weight CRUD, versioning)
├── cycle/         (cycle config, orchestration)
└── audit/         (centralized audit logging)
```

### Key Architectural Decisions
1. Single `member1/` directory under `apps/api/src/` containing all sub-modules
2. One NestJS module (Member1Module) that registers all controllers, services, providers
3. Direct Prisma access via PrismaService (shared with Member 2)
4. Services export interfaces that match or extend Member 2's contract definitions
5. All Member 1 models share the same Prisma schema file as Member 2/3

## Database Design

### New Models (10)
| Model | Purpose | Key Relationships |
|-------|---------|-------------------|
| CycleConfig | Per-cycle configuration (1:1 with SelectionCycle) | → SelectionCycle, → WeightVersion |
| EligibilityRuleVersion | Versioned eligibility rule sets | → SelectionCycle |
| EligibilityResult | Per-student eligibility evaluation | → Student, → SelectionCycle, → EligibilityRuleVersion |
| WeightVersion | Versioned weight configurations | → SelectionCycle |
| ParameterWeight | Individual parameter weights | → WeightVersion |
| StudentScore | Computed per-parameter scores | → Student, → SelectionCycle, → WeightVersion |
| StudentRanking | Computed ranking per student | → Student, → SelectionCycle, → WeightVersion |
| FreezeSchedule | Scheduled ranking freeze | → SelectionCycle, → RankingSnapshot |
| RankingSnapshot | Immutable frozen ranking | → SelectionCycle, → WeightVersion |
| RankingSnapshotEntry | Per-student snapshot data | → RankingSnapshot, → Student |
| HopePepClassification | Program assignment | → Student, → SelectionCycle, → RankingSnapshot |
| ScoreAuditLog | Member 1 audit trail | → SelectionCycle |

### New Enums (2)
- FreezeStatus: SCHEDULED, EXECUTED, CANCELLED, POSTPONED
- ClassificationStatus: CLASSIFIED, HOPE_INTERVIEW_FAILED, PEP_FALLBACK_ALLOWED, PEP_FALLBACK_DENIED

### Reused Models (8)
Student, SelectionCycle, StudentCycleStatus, AssessmentResult, Program, WorkflowAuditLog, Domain, TrainingBatch

## Scoring Design
- Pipeline: raw score → validate → flag missing → normalize (passthrough default) → apply weight → sum = total
- Missing scores: rawScore=0, isMissing=true (distinguishable from genuine zero)
- Normalization: isolated function, passthrough by default, swappable without rewriting ranking
- Each StudentScore record captures: rawScore, isMissing, normalizedScore, weight, weightedScore

## Eligibility Design
- Separate from ranking (evaluated before ranking, does not determine rank position)
- Rule engine: JSON-structured rules in EligibilityRuleVersion (parameter, operator, threshold)
- Operators: GTE, LTE, GT, LT, EQ, NEQ, EXISTS, MIN_COUNT
- Returns ALL failures per student (not just first)
- Drives StudentCycleStatus transition to ELIGIBILITY

## Ranking Design
- ONE common ranking for ALL students (not split by HOPE/PEP)
- Sort by totalScore descending
- Tie-breaking via pluggable TieBreakStrategy interface
- Produces: rank, totalScore, percentile, tieBreakApplied flag
- Live ranking (queryable before freeze) vs frozen snapshot

## HOPE/PEP Design
- Classification runs on FROZEN common ranking
- Top hopeCount students → HOPE, next pepCount → PEP
- hopeCount and pepCount are configurable per cycle via CycleConfig
- No hardcoded values
- Students beyond boundary → program=null (not classified)
- HOPE → PEP fallback: explicit admin decision with 4 statuses (CLASSIFIED → HOPE_INTERVIEW_FAILED → PEP_FALLBACK_ALLOWED or PEP_FALLBACK_DENIED)

## Freeze Design
- Admin schedules future date → FreezeSchedule (SCHEDULED)
- Timer checks every 60 seconds
- At scheduled time: captures ALL data (scores, weights, ranks, eligibility) into immutable snapshot
- Countdown API: returns days/hours/minutes/seconds until freeze
- Cancel/postpone with reason required
- Correction: new snapshot version (N+1), previous preserved
- Post-freeze data imports affect only live ranking, never frozen snapshot

## Weight Versioning
- Each edit creates a new WeightVersion (monotonically increasing version number)
- Old versions never deleted or modified
- Changing weights does NOT auto-recalculate ranking
- Admin must explicitly trigger recalculation
- Every StudentScore, StudentRanking, and RankingSnapshot references which WeightVersion was used

## Member 2 Integration
- Implement all 4 contract interfaces from member1.contract.ts
- Drive WorkflowState transitions: IMPORTED → ELIGIBILITY → HOPE_PEP → SELECTION
- Each transition writes to both WorkflowAuditLog (Member 2) and ScoreAuditLog (Member 1)
- Allocation.selectionResultReference links to RankingSnapshot.id
- Member 2's allocation.generate() reads students where currentState = SELECTION (set by Member 1)

## Member 3 Integration
- Replace demo eligibility in demo.service.ts with EligibilityService calls
- Replace hardcoded checks in intelligence.service.ts and reports.service.ts
- Integration via direct NestJS service injection (same process)
- DEMO_MODE preserved as fallback when Member 1 not active
- Future: event-driven hook for eligibility recalculation

## API Design
- 28 endpoints across 8 areas (cycles, weights, eligibility, ranking, classification, freeze, snapshots, audit)
- Follows existing NestJS conventions: /api prefix, class-validator DTOs, Swagger decorators
- Auth via x-role header (matching existing pattern)
- Actor tracking via x-actor-id header
- Pagination on list endpoints (page, pageSize)

## Audit Design
- Dual system: WorkflowAuditLog for state transitions, ScoreAuditLog for Member 1 operations
- 15 auditable action types defined
- Each entry: who, what, when, old value, new value, reason, cycle, version
- Append-only (never modified or deleted)

## Test Strategy
- 6 test categories: scoring (6 tests), ranking (6), weights (6), freeze (8), HOPE/PEP (7), eligibility (5), integration (6), audit (4)
- Total: ~48 test cases defined
- Framework: Jest + Supertest (matching existing e2e pattern)

## Open Decisions

| # | Decision | Blocking? |
|---|----------|-----------|
| 1 | Exact 12 parameter names/keys | No — architecture supports any parameter set |
| 2 | Default weight values | No — admin creates first version at runtime |
| 3 | Parameter score ranges | No — normalization passthrough until decided |
| 4 | Exact eligibility rules | No — admin creates at runtime |
| 5 | Tie-break hierarchy | No — strategy is pluggable |
| 6 | Privacy/name visibility | No — frontend concern |
| 7 | Snapshot retention period | No — all kept until decided |
| 8 | Notification provider | No — countdown is a query API |
| 9 | Normalization formula | No — passthrough default |
| 10 | dsaLevel → numeric mapping | Partially — depends on #1 |

None of the open decisions block implementation. The architecture accommodates all of them as configuration.

## Files Created
- `docs/MEMBER_1_ARCHITECTURE.md` — Complete architecture document (20 sections)
- `logs/PROMPT_02.md` — This log file

## Files Modified
- `logs/README.md` — Updated log index with Prompt 02 entry

## Tests / Verification
- Re-read logs/PROMPT_01.md to verify all findings were incorporated
- Re-read Member 2 contract (member1.contract.ts) to verify all 4 interfaces are addressed
- Re-read Member 2 Prisma schema to verify model reuse decisions are correct
- Re-read Member 3 domain.ts to verify CanonicalStudent fields are accounted for
- Verified proposed Member 1 models do not duplicate any existing Member 2/3 model
- Verified WorkflowState enum includes ELIGIBILITY and HOPE_PEP states that Member 1 will drive
- Verified API conventions match existing NestJS patterns (x-role header, Swagger, class-validator)
- Did NOT run any code (architecture-only prompt)
- Did NOT modify Prisma schema, services, controllers, or any existing code

## Issues Encountered
1. The project decisions provided in this prompt resolved several items that were previously listed as open (single common ranking, HOPE/PEP classification from frozen ranking, weight change workflow, freeze scheduling requirement). These have been incorporated as established requirements.
2. The exact 12 parameter names remain undefined but the architecture is designed to accept any set of parameter keys without code changes.
3. Member 2's branch is still not merged to main. The architecture assumes Member 2's Prisma schema will be available when implementation begins.

## Integration Impact
- The architecture document establishes clear boundaries: Member 1 owns eligibility/ranking/scoring, Member 2 owns allocation, Member 3 owns integration/AI
- Member 2 integration is fully mapped: 4 contracts, 3 state transitions, audit integration
- Member 3 integration is mapped: 5 replacement points for demo eligibility, service injection boundary
- No existing code was modified in this prompt

## Git Changes
No git changes. Only local file creation (docs/MEMBER_1_ARCHITECTURE.md, logs/PROMPT_02.md, logs/README.md update).

## Final Status
COMPLETED
