# Deployment checklist

## Before deployment

1. Copy `.env.example` to the platform's secret store. Do not commit `.env`.
2. Replace `INTEGRATION_API_KEY`; configure the API gateway to authenticate Project 1/2/8 callers.
3. Replace the demo `x-role` header with verified identity claims.
4. Provision PostgreSQL with backups and point `DATABASE_URL` to it.
5. Run `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`.
6. Confirm Team A's student/cycle repositories and event handlers are wired.
7. Verify CORS, TLS, rate limits, maximum import size, and log redaction.

## Release gates

- `npm run typecheck`, `npm test`, `npm run build`, and Python tests are green.
- The API and Excel versions of the same sample reconcile.
- A repeated batch key does not change source counts.
- Project 1/8 retries do not overwrite result history.
- AI outage produces advisory fallback without touching official decisions.
- An unprivileged user cannot approve a recommendation.
- Capacity is checked at recommendation and again at approval.
- Report totals match direct database queries for the active cycle.

## Operations

- Health checks: `/api/health` and AI `/health`.
- Swagger: `/api/docs`.
- Monitor failed `integration_jobs`, retry counts, processing latency, duplicate ratio, and stale sources.
- Alert on repeated validation failures, source silence, capacity conflicts, or approval verification failure.
- Keep structured logs free of certificate documents, resumes, email bodies, and other unnecessary personal data.

## Rollback

Application containers are stateless; redeploy the previous image. Do not roll back imported business events by deleting them. Use an authorized compensating event with a reason and audit record.
