# Contributing to Project 9

## Branches
- `main`: stable.
- `develop`: integration.
- `feature/member1-<task>`, `feature/member2-<task>`, `feature/member3-<task>`.

## Commit style
Use concise messages such as `feat: add dashboard`, `fix: validate input`, `docs: update setup`, `chore: update CI`.

## Pull requests
Target `develop`. Explain what changed, why, how it was tested, and whether API contracts or DB schema changed.

## Secrets
Never commit credentials, API keys or local `.env` files. Use `.env.example`.
