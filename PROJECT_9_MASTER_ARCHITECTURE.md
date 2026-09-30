# Project 9 — Master Architecture

## Product architecture

```text
React Operations UI
        |
        v
NestJS API
  |     |        |          |
  |     |        |          +--> FastAPI advisory AI
  |     |        +--> Integration Gateway (Projects 2 / 1 / 8 + CSV/XLSX)
  |     +--> Workflow + Allocation
  +--> Eligibility / Scoring / Ranking / Classification / Freeze
        |
        v
PostgreSQL + Prisma
```

## Authority boundaries

- PostgreSQL is the source of truth for official student, cycle, eligibility, ranking, classification, assessment, allocation, admin-decision and audit data.
- The deterministic Member 1 engine decides eligibility/ranking/classification.
- The workflow/allocation engine controls state progression, preference allocation, approval and freeze.
- Project 1/2/8 adapters validate and project external data into normalized official tables.
- AI is advisory only. It cannot directly write eligibility, rank, classification or capacity.
- An approved agent recommendation is routed through the official AllocationService, checked against live capacity, audited and verified.
- `RuntimeState` / file-backed Store remains only for advisory/demo compatibility and does not replace official PostgreSQL state.

## Repository boundaries

- `apps/web` — React operations dashboard and allocation UI.
- `apps/api` — NestJS HTTP/API layer and official business logic.
- `apps/api/src/member1` — eligibility, scoring, weights, ranking, classification, freeze and selection-result logic.
- `apps/api/src/allocation` — capacity-aware allocation, approval, rejection and freeze.
- `apps/api/src/auth` — signed bearer authentication and production request guard.
- `apps/api/src/official-integration.service.ts` — Project 2/1/8 projection into official tables.
- `apps/api/src/official-read.service.ts` — official dashboard/report read model.
- `services/ai` — bounded FastAPI advisory service.
- `apps/api/prisma` — Prisma schema and ordered migrations.
- `docs` — architecture, deployment and engineering records.

## Main workflow

```text
Project 2 -> Student/Assessment/Credential/Preference import
          -> Eligibility
          -> Ranking
          -> HOPE/PEP/WAITLIST classification
          -> Project 1 communication
          -> Eligibility re-evaluation
          -> Project 8 interview
             -> PASS -> selection
             -> HOPE FAIL -> PEP fallback
             -> later FAIL -> ADMIN_REVIEW
          -> Allocation
          -> Admin approval
          -> Finalize / Freeze
```

## Concurrency and integrity

- Integration requests use idempotency keys.
- Assessment source identifiers are unique per student.
- Ranking/freeze results are versioned and frozen snapshots remain authoritative.
- Training-batch seat claims use an atomic compare-and-increment inside a Prisma transaction.
- Capacity exhaustion is distinct from eligibility failure.
- Official workflow changes and admin decisions create audit records.
- Production containers use `prisma migrate deploy`.

## Authentication

When `AUTH_REQUIRED=true`:
- UI/API users authenticate with a signed bearer token.
- Token claims overwrite any user-supplied `x-role` / `x-actor-id`.
- Mutating decision endpoints require staff/admin roles.
- Project 1/2/8 integration calls require the configured integration API key unless an authenticated bearer token is used.
- Health, Swagger, login and one-time administrator bootstrap remain public endpoints.

## Branch integration

The final integrated branch is built from Member 3 main + Member 2 allocation/workflow + Member 1 eligibility/ranking. Feature work should now branch from the integrated main/develop baseline rather than stacking new work on the old member branches.
