# Deployment checklist

## Required production configuration

Set secrets in the deployment platform rather than committing a .env file.

```env
DATABASE_URL=postgresql://...
PERSISTENCE_DRIVER=postgres
OFFICIAL_PROJECTION=true
DEMO_MODE=false
AUTH_REQUIRED=true
AUTH_TOKEN_SECRET=<32+ character random secret>
ADMIN_BOOTSTRAP_KEY=<one-time bootstrap secret>
INTEGRATION_API_KEY=<Project 1/2/8 shared secret>
ENABLE_FREEZE_SCHEDULER=true
AI_SERVICE_URL=http://ai:8000
WEB_ORIGIN=https://your-web-origin.example
```

## Before release

1. Provision PostgreSQL with backups.
2. Run `npm run prisma:deploy -w apps/api`.
3. Bootstrap the first administrator through `POST /api/auth/bootstrap`, then rotate/remove the bootstrap secret if your platform supports it.
4. Configure Project 1/2/8 callers to send both `Idempotency-Key` and `x-integration-api-key`.
5. Confirm Project 2, Project 1 and Project 8 contracts use the target `selectionCycleId`.
6. Verify CORS, TLS, API gateway limits, import-size limits and log redaction.
7. Keep `DEMO_MODE=false` on the deployed product.

## Release gates

- `npm run typecheck` passes.
- `npm test` passes against PostgreSQL.
- `npm run build` passes.
- `python -m pytest services/ai` passes.
- A fresh database successfully applies the entire Prisma migration history.
- Project 2 data appears in normalized Student/Assessment/Credential/Preference tables.
- Project 1 result ingestion triggers deterministic eligibility re-evaluation.
- Project 8 HOPE failure routes to PEP fallback; the later failed path reaches ADMIN_REVIEW.
- Eligible students beyond HOPE/PEP capacity are WAITLIST, not NOT_ELIGIBLE.
- Concurrent allocation cannot overbook a training batch.
- AI recommendations cannot change official allocation without an authorized approval.
- Approved AI recommendations are written through and verified against the official Allocation table.
- Unauthenticated protected calls fail when AUTH_REQUIRED=true.
- A STUDENT token cannot become ADMIN by sending a forged x-role header.
- Report totals match direct PostgreSQL data.

## Operations

- Health: `/api/health`
- AI health: `/health` on the AI service
- Swagger: `/api/docs`
- Authentication: `/api/auth/login`, `/api/auth/me`
- Monitor failed integration jobs, validation failures, stale external sources, capacity conflicts, admin-review backlog and freeze-scheduler failures.
- Keep imported personal data, certificate documents and assessment notes out of application logs.

## Database changes

Containers run `prisma migrate deploy`; do not use `prisma db push` in production.

The migration folders were reordered to make a clean install deterministic. Any developer database created with the older pre-integration migration names should be recreated/reset before using the final migration history.

## Rollback

Application containers are stateless. Roll back the application image if needed, but do not delete imported business events or frozen records to reverse a decision. Use an authorized compensating/admin action with a reason and retain the audit trail.
