# Architecture and integration decisions

## End-to-end flow

```text
Project 2 / CSV-XLSX
        |
        v
Integration Gateway
validate -> normalize -> idempotency -> official projection
        |
        v
Student + Assessment + Verified Credential + Preference tables
        |
        v
Eligibility -> Ranking -> HOPE / PEP / WAITLIST
        |
        +----> Project 1 communication
        |         |
        |         v
        |     re-evaluate eligibility
        |
        +----> Project 8 interview
                  |
                  +-> PASS -> Selection
                  +-> HOPE FAIL -> PEP fallback
                  +-> later FAIL -> Admin Review

Selection -> Preference/Capacity Allocation -> Approval -> Freeze
        |
        +----> advisory AI / selection intelligence
                  recommend -> human approval -> official allocation service
```

External projects never write rule/rank/allocation tables directly. The integration gateway owns transport/idempotency and projects validated external records into normalized tables. Official business services remain authoritative.

## Data authority

PostgreSQL is the official source of truth for:
- Student, Department, Batch and SelectionCycle
- AssessmentResult and StudentCredential
- EligibilityResult and rule versions
- StudentScore, StudentRanking and ranking snapshots
- HopePepClassification
- StudentPreference, TrainingBatch and Allocation
- StudentCycleStatus, AdminDecision and workflow/score audit logs

The file/PostgreSQL RuntimeState store remains only for advisory/demo compatibility and Member 3 legacy UI state. Official dashboard/report endpoints read normalized Prisma tables when official projection is enabled.

## Deterministic decision boundary

AI does not decide official eligibility, rank, classification, capacity or selection. The rule/ranking engine is deterministic and versioned.

Capacity exhaustion is represented separately from eligibility failure:
- `NOT_ELIGIBLE` = institutional rules failed.
- `WAITLIST` = eligible, but HOPE/PEP capacity is currently exhausted.

## Allocation integrity

Training-batch capacity is claimed with an atomic SQL compare-and-increment inside a Prisma transaction. Creating the Allocation row and audit record occurs in the same transaction, preventing concurrent requests from taking the same final seat.

Approved AI recommendations call the same AllocationService, recheck live capacity, create an auditable official allocation and verify the written result before the recommendation becomes `VERIFIED`.

## External integration reliability

- Modifying integration requests require a stable `Idempotency-Key`.
- Project 1 result IDs and Project 8 attempt IDs are unique per student.
- API and CSV/XLSX Project 2 ingestion use the same DTO and official projection code path.
- Project 1 results are persisted as communication assessments and trigger eligibility re-evaluation.
- Project 8 attempts are append-only and update workflow/classification state without deleting prior attempts.
- Workflow state changes from external systems are written to WorkflowAuditLog.

## Authentication

Production mode uses signed bearer tokens:
- `POST /api/auth/login` authenticates a User.
- Token claims overwrite client-supplied actor/role headers.
- Mutating rules/ranking/freeze/agent operations require ADMIN or COORDINATOR.
- Allocation approvals and advisory decisions allow faculty only for their assigned domain; administrators and coordinators retain cross-domain authority.
- Student accounts are bound to one Student row and can read only their own selection profile. Faculty accounts are bound to one Domain row but may read all student profiles; only their assigned domain permits approval actions. Only administrators manage accounts.
- Project 1/2/8 integration calls can authenticate with `x-integration-api-key`.
- `AUTH_REQUIRED=false` is retained only for local development/backward-compatible tests.

## Freeze authority

Before freeze, live eligibility/ranking/classification is authoritative. After freeze, RankingSnapshot + RankingSnapshotEntry is authoritative. Live recalculation is blocked from silently replacing a frozen selection.

The freeze scheduler is opt-in through `ENABLE_FREEZE_SCHEDULER=true` and executes due schedules through the same FreezeService used by manual execution.

## Database migrations

Prisma migrations are ordered from base schema through integration/auth-related schema changes and are applied with:

```bash
npm run prisma:deploy -w apps/api
```

Production containers never use `prisma db push`.
