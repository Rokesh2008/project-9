# Architecture and integration decisions

## Flow

```text
Project 2 / Project 1 / Project 8 / CSV-XLSX
                    |
            Integration Gateway
       validate -> normalize -> idempotency
                    |
             Canonical DTOs + logs
                    |
        Team A deterministic rule engine
                    |
           official eligible pool
                    |
      Advisory AI + Selection Agent
 analyze -> conflicts -> recommend -> explain
                    |
     authorized decision -> apply -> verify
                    |
            reports + audit events
```

External systems never call internal rule or allocation methods directly. The gateway owns transport concerns; Team A owns institutional decisions.

## Data ownership

Member 3 owns `integration_sources`, `integration_jobs`, `integration_logs`, `external_references`, `ai_student_analysis`, `agent_runs`, `agent_recommendations`, and `report_snapshots`. The Prisma schema defines uniqueness and lifecycle fields for those entities.

Official student, eligibility, rank, program selection, capacity, and allocation tables are intentionally not duplicated here. During integration, repository ports should reference those shared entities by ID.

## Reliability model

- A caller supplies a stable idempotency key per logical batch.
- Payload validation happens before any loop writes records.
- The same event key returns the original result.
- Project 1 `resultId` and Project 8 `attemptId` are separately unique, preventing overwrite while allowing multiple attempts.
- Every job records source, operation, method, count, timing, status, and error.
- AI calls have a short timeout and deterministic fallback; an AI outage cannot block official selection.
- Approval rechecks capacity immediately before applying, then reads the allocation back to verify it.

## Published capacity baseline

The supplied 2029 prerequisites document lists capacities for PEPC 1-18: 70, 60, 120, 70, 70, 70, 70, 60, 40, 60, 40, 40, 40, 50, 100, 50, 100, and 50. These values are seeded as a reporting baseline, not immutable policy. A production cycle should version them in Team A's capacity tables and require authorized changes.

## Known handoff assumptions

- Interview eligibility and final selection are separate stages.
- Programming-round clearance plus completed domain prerequisites makes a student eligible for a one-to-one interview; it does not guarantee final selection.
- The prerequisite document contains dates and external course links that may change. They should be ingested into versioned rule configuration only after coordinator review.
- Project 1 and Project 8 payload field names may differ in the final systems. Keep the canonical DTOs stable and change only the adapter mappings.

## Standalone dependency mode

`DEMO_MODE=true` enables controlled simulators for the systems that are not yet delivered. The simulator generates Project 2-style student inputs, a deterministic demo eligibility projection, Project 1 communication results, and Project 8 interview results. Every simulated transition is labelled `DEMO_ONLY` and audited. Set `DEMO_MODE=false` when real adapters are available; no dashboard or agent contract changes are required.

Standalone development persists an atomic JSON snapshot. Docker sets `PERSISTENCE_DRIVER=postgres`, initializes the Prisma schema, and persists the same state in PostgreSQL. This allows the module to run today without weakening its production database path.
