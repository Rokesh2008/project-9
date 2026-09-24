# Project 9 — Master Architecture

## High-level architecture

```text
Web Frontend -> Backend API -> Database
                         \\-> AI Service
Shared contracts/types/config live in packages/
```

## Repository boundaries

- `apps/web`: UI, routing, pages, components and API consumption.
- `apps/api`: HTTP endpoints, validation and business logic.
- `apps/ai-service`: AI/agent/model orchestration.
- `packages/contracts`: shared API request/response contracts.
- `packages/types`: shared framework-agnostic domain types.
- `packages/config`: shared tooling configuration.
- `prisma`: database schema and migrations.
- `docs`: architecture, setup and decisions.

## Team workflow

```text
main
  ↑
develop
  ↑
PRs
  ↑
feature/member1-*
feature/member2-*
feature/member3-*
```

Each teammate works from `develop`, creates a feature branch, commits focused changes, opens a PR into `develop`, gets review, fixes CI/review issues, and merges when ready.

## Conflict prevention

- Coordinate shared contracts, DB schema, root config, Docker and CI changes.
- Avoid editing the same files concurrently.
- Update from `develop` before final integration.
- Never force-push another teammate's branch.
