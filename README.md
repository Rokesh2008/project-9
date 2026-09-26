# Project 9 - Member 3: Integration, AI Analysis & Analytics

Production-oriented baseline for the Member 3 responsibilities in the PEP/HOPE Selection, Ranking & Training Allocation Automation Platform.

## What is implemented

- Integration gateway for Project 2 student/readiness data, Project 1 communication results, and Project 8 interview results.
- Canonical validation shared by API and CSV/XLSX imports.
- Request idempotency, duplicate result protection, import logs, failure visibility, and source metadata boundaries.
- Project 1 and Project 8 candidate exports plus append-only result/attempt histories.
- Advisory student analysis with a controlled FastAPI service and a deterministic NestJS fallback.
- Stateful selection-intelligence workflow: read eligible pool, analyze, detect conflicts, recommend, require authorized approval, apply, and verify.
- Dependency simulator for Projects 1, 2, 8 and the unavailable eligibility/ranking modules, isolated behind `DEMO_MODE`.
- Non-mutating what-if analysis, duplicate/data-quality anomaly detection, audit history, and CSV report exports.
- Selection and domain-capacity reports using the 18 published PEPC capacities.
- React integration/analytics dashboard with manual import, monitoring, agent queue, and approval controls.
- PostgreSQL/Prisma ownership schema, Docker Compose, Swagger, Jest/Supertest, Pytest, and GitHub Actions.

## Safety boundary

AI receives only performance/profile features and returns only strengths, gaps, trends, and domain recommendations. It has no endpoint or data model capable of writing official eligibility, marks, rank, capacity, classification, or final-selection fields. An allocation recommendation is applied only after an `ADMIN` or `PLACEMENT_COORDINATOR` supplies an explicit decision, and the resulting allocation is verified.

The application persists standalone state to `data/runtime-state.json`. Docker deployment uses PostgreSQL through Prisma when `PERSISTENCE_DRIVER=postgres`. The deterministic eligibility/ranking engine remains Team A's eventual source of truth; until it is available, the explicitly labelled dependency simulator supplies replaceable demo outputs.

## Run locally

### Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

- Dashboard: <http://localhost:5173>
- Swagger/OpenAPI: <http://localhost:3000/api/docs>
- API health: <http://localhost:3000/api/health>
- AI service health: <http://localhost:8000/health>

Click **Prepare standalone demo** to populate student data, calculate demo-only eligibility, and simulate Project 1 and Project 8 results. Then run the advisory agent, analyze students, test what-if improvements, and approve conflict-free recommendations.

### Node development

```bash
npm install
npm run dev
```

Run the AI service separately if advisory-service integration is required. If it is unavailable, the API uses a bounded deterministic fallback.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r services/ai/requirements.txt
uvicorn services.ai.app:app --reload --port 8000
```

## Verify

```bash
npm run typecheck
npm test
npm run build
python -m pytest services/ai
```

The API tests cover invalid-payload rejection, idempotent replay, API/CSV mapping parity, append-only boundaries, AI non-mutation, role-gated approval, and allocation verification.

## Core contracts

Every modifying integration request requires an `Idempotency-Key` header. Replaying the same key returns the stored outcome with `duplicate: true` and does not create another business record.

| Method | Endpoint | Responsibility |
|---|---|---|
| `POST` | `/api/integrations/project2/students` | Import validated Project 2 records |
| `GET` | `/api/integrations/project1/candidates` | Export communication-assessment candidates |
| `POST` | `/api/integrations/project1/results` | Append communication results |
| `GET` | `/api/integrations/project8/candidates` | Export interview candidates |
| `POST` | `/api/integrations/project8/results` | Append interview attempts |
| `POST` | `/api/integrations/import/excel` | CSV/XLSX fallback using the canonical DTO |
| `GET` | `/api/integrations/templates/students.csv` | Download the exact import template |
| `GET` | `/api/integrations/logs` | Monitor transfers and failures |
| `POST` | `/api/ai/students/:id/analyze` | Generate advisory analysis |
| `POST` | `/api/ai/students/:id/what-if` | Compare a non-mutating improvement scenario |
| `GET` | `/api/ai/anomalies` | Detect duplicate and incomplete records |
| `POST` | `/api/demo/run-dependency-simulation` | Stand in for unavailable Projects 1/2/8 and Team A modules |
| `POST` | `/api/agent/selection/run` | Create recommendations for the eligible pool |
| `POST` | `/api/agent/selection/recommendations/:id/decision` | Role-gated decision and verification |
| `GET` | `/api/reports/selection-summary` | Reconciled selection totals |
| `GET` | `/api/reports/domain-capacity` | Demand, capacity, allocated, and available seats |
| `GET` | `/api/reports/selection.csv` | Download the selection report |
| `GET` | `/api/reports/domain-capacity.csv` | Download the capacity report |

### Example Project 2 import

```bash
curl -X POST http://localhost:3000/api/integrations/project2/students \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: p2-batch-2026-09-24' \
  -d '{
    "sourceBatchId": "P2-2026-09-24",
    "records": [{
      "studentId": "S-001",
      "registerNumber": "REG001",
      "name": "Example Student",
      "department": "CSE",
      "email": "student@example.edu",
      "cgpa": 8.2,
      "codingScore": 78,
      "aptitudeScore": 74,
      "attendancePercent": 91,
      "dsaLevel": "INTERMEDIATE",
      "preferences": ["PEPC-01 AI/ML", "PEPC-05 Data Science"],
      "completedCertificates": ["Data Science Foundation"],
      "program": "UNASSIGNED",
      "sourceUpdatedAt": "2026-09-24T00:00:00.000Z"
    }]
  }'
```

## Merge points for the rest of the team

1. Disable `DEMO_MODE` and map the provided adapters to the real Project 1, 2, and 8 endpoints.
2. Subscribe to the deterministic rules engine's `student.eligibility.recalculated` event after Project 1/8 imports.
3. Read eligible students and official cycle context from Team A instead of the local store.
4. Write a verified allocation through Team A's authorized allocation command, never through the AI service.
5. Connect the project's authentication middleware so `x-role` comes from signed claims rather than a request header. The standalone module keeps this replaceable boundary visible.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for ownership boundaries and operational steps.
