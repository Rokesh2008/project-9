# 30-day responsibility traceability

| Milestone | Baseline evidence |
|---|---|
| Days 1-3 contracts and fallback | DTOs, Swagger routes, CSV template, architecture decisions |
| Days 4-5 schema and deployment plan | Prisma schema, Docker Compose, deployment checklist |
| Days 6-8 Project 2 ingestion | Validated normalization, idempotency, tests |
| Days 9-10 CSV/XLSX fallback | SheetJS parser using the Project 2 canonical DTO |
| Days 11-12 Project 1 | Candidate export and append-only result ingestion |
| Days 13-15 Project 8 | Candidate export and append-only interview-attempt ingestion |
| Days 16-18 AI and analytics | Controlled FastAPI analysis, dashboard, two report endpoints |
| Days 19-22 selection agent | Stateful recommendation, conflict detection, role-gated approval, apply/verify, what-if and anomaly support |
| Days 23-25 integration testing | Supertest acceptance paths and Pytest boundary test |
| Days 26-29 operations | Job logs, health endpoints, Docker, GitHub Actions, runbooks |
| Day 30 demo | Dashboard supports live import, monitoring, analytics, agent run, and approval |

P1 what-if and anomaly support is implemented as an advisory, non-mutating layer. Official records remain unchanged until an authorized allocation command is approved and verified.
