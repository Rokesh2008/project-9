# Contributing to Project 9

## Branches
- `main`: integrated stable baseline and current pull-request target.
- `feature/member1-<task>`, `feature/member2-<task>`, `feature/member3-<task>`: feature work.

Create feature branches from the latest `main` baseline instead of stacking new work on older member branches.

## Commit style
Use concise messages such as `feat: add dashboard`, `fix: validate input`, `docs: update setup`, `chore: update CI`.

## Pull requests
Target `main`. Explain what changed, why, how it was tested, and whether API contracts or DB schema changed.

## Secrets
Never commit credentials, API keys or local `.env` files. Use `.env.example`.
