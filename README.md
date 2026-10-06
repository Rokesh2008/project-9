# Project 9 — PEP/HOPE Selection, Ranking & Training Allocation Automation

Integrated implementation of Project 9. The repository now contains the deterministic eligibility/ranking engine, student workflow and allocation engine, Project 1/2/8 integration gateway, advisory AI/analytics, audit/freeze support, authentication, and the React operations dashboard.

## Implemented product flow

```text
Project 2
  -> normalized student/readiness/verified-certificate data
  -> Project 9 eligibility + ranking + HOPE/PEP classification
  -> Project 1 communication assessment
  -> Project 9 eligibility re-evaluation
  -> Project 8 interview
  -> Project 9 selection/allocation/admin review
  -> approval + finalization + freeze
```

Key behavior:
- Eligibility, ranking, capacity and final official state are deterministic and stored in PostgreSQL.
- Capacity exhaustion produces `WAITLIST`, not `NOT_ELIGIBLE`.
- Project 1 results trigger official eligibility re-evaluation.
- A HOPE interview failure routes the student to PEP fallback; a subsequent failed PEP path enters `ADMIN_REVIEW`.
- Allocation capacity claims are atomic and transaction-protected.
- AI recommendations are advisory until an authorized human approves them; approved recommendations are applied through the official allocation service and verified.
- CSV/XLSX fallback uses the same Project 2 DTO and official projection path as API ingestion.
## Technology

- React + TypeScript + Vite
- NestJS + TypeScript
- PostgreSQL + Prisma
- FastAPI + Pydantic for advisory AI
- Jest/Supertest + Pytest
- Docker Compose + GitHub Actions

## Local development

### 1. Install dependencies

```bash
npm ci
npm run prisma:generate -w apps/api
```

### 2. Start PostgreSQL

Use Docker Compose or your own PostgreSQL instance.

```bash
docker compose up -d postgres
export DATABASE_URL='postgresql://project9:project9@localhost:5432/project9?schema=public'
npm run prisma:deploy -w apps/api
```

### 3. Start the API and web app

```bash
npm run dev
```

- Dashboard: <http://localhost:5173>
- Swagger: <http://localhost:3000/api/docs>
- API health: <http://localhost:3000/api/health>
### 4. Optional AI service

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r services/ai/requirements.txt
uvicorn services.ai.app:app --reload --port 8000
```

If the AI service is unavailable, advisory analysis has a bounded deterministic fallback. Official eligibility/ranking/allocation never depends on an LLM response.

## Authentication and production mode

Authentication is required by default. Development can opt into `AUTH_REQUIRED=false` only for isolated local testing. For deployment set:

```env
AUTH_REQUIRED=true
AUTH_TOKEN_SECRET=<32+ character random secret>
ADMIN_BOOTSTRAP_KEY=<one-time bootstrap secret>
INTEGRATION_API_KEY=<Project 1/2/8 shared API secret>
PERSISTENCE_DRIVER=postgres
OFFICIAL_PROJECTION=true
DEMO_MODE=false
ENABLE_FREEZE_SCHEDULER=true
```

Create the first administrator once:

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -H 'x-bootstrap-key: <ADMIN_BOOTSTRAP_KEY>' \
  -d '{"name":"Admin","email":"admin@example.edu","password":"change-this-password"}'
```

Then sign in via `POST /api/auth/login` or the web dashboard. In production, authenticated token claims override client-supplied role/actor headers.
External integration endpoints require `x-integration-api-key` when authentication enforcement is enabled. Modifying integration requests also require an `Idempotency-Key`.

An administrator can manage accounts in the dashboard or through `GET/POST /api/accounts` and `PATCH /api/accounts/:id`. Student accounts must link to one imported student; faculty (`PEP_STAFF`) accounts must link to one active domain. Students can read only `GET /api/profiles/me`. Staff can search `GET /api/profiles` and open any student’s read-only `GET /api/profiles/:studentId` explanation. Faculty recommendation and allocation queues are filtered to their domain, and the API rejects cross-domain decisions. Deactivation, role changes, and password resets revoke existing sessions. Profiles explain eligibility failures, waitlist outcomes, ranking/classification, and next steps from official cycle records; advisory recommendations never finalize an allocation automatically.

## Core endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/integrations/project2/students` | Project 2 student/readiness import |
| GET | `/api/integrations/project1/candidates?selectionCycleId=...` | Export communication candidates |
| POST | `/api/integrations/project1/results` | Import communication results and re-evaluate |
| GET | `/api/integrations/project8/candidates?selectionCycleId=...` | Export interview candidates |
| POST | `/api/integrations/project8/results` | Import interview attempts and advance workflow |
| POST | `/api/integrations/import/excel` | CSV/XLSX fallback |
| POST | `/api/selection-pipeline/run` | Run configured scoring -> eligibility -> ranking -> HOPE/PEP/WAITLIST in one operation |
| POST | `/api/eligibility/evaluate` | Run deterministic eligibility |
| POST | `/api/ranking/calculate` | Calculate deterministic ranking |
| POST | `/api/classification/calculate` | Apply HOPE/PEP capacity classification |
| GET | `/api/selection/:cycleId/results` | Explainable selection results |
| POST | `/api/allocations/generate` | Preference/capacity-aware allocation |
| POST | `/api/agent/selection/run` | Produce advisory recommendations |
| POST | `/api/agent/selection/recommendations/:id/decision` | Human approval/rejection |
| GET | `/api/reports/selection-summary` | Official active-cycle summary |
| GET | `/api/reports/domain-capacity` | Official domain demand/capacity |
| GET | `/api/reports/audit-trail` | Official workflow + decision audit trail |
## Project 2 import fields

The API/CSV import accepts the existing fields plus optional `selectionCycleId`, `batchIdentifier`, `academicYear` and `readinessScore`. Verified certificates are projected to `StudentCredential`; coding, aptitude and readiness values are stored as assessment results.

The exact CSV template is available at:

```text
GET /api/integrations/templates/students.csv
```

The integrated selection-pipeline scorer only uses parameters that an administrator has explicitly configured in the active weight version. Built-in source aliases currently cover `coding`, `aptitude`, `cgpa`, `attendance`, `readiness`/`project2`, `communication`, `interview`, and verified `certificateCount`; unknown configured keys are recorded as missing rather than guessed.

## Verification

```bash
npm run typecheck
npm test
npm run build

python3.12 -m venv /tmp/project9-ai-venv
/tmp/project9-ai-venv/bin/pip install -r services/ai/requirements.txt
/tmp/project9-ai-venv/bin/python -m pytest services/ai
```

The API suite covers deterministic rule/ranking behavior, freeze authority, capacity allocation, official Project 2 -> 9 -> 1 -> 9 -> 8 flow, AI approval into official allocation, authentication/RBAC, idempotency and reporting.

## Database migrations

Production containers run `prisma migrate deploy`; they do not use `prisma db push`. The migration folders were ordered so a completely fresh PostgreSQL database can apply the full history successfully.

If you created a local database using the older pre-integration migration names, recreate/reset that development database before using the reordered migration history.

See `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md` for operational details.
