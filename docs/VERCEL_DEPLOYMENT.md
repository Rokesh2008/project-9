# Hosted Project 9

- Website: https://project9-college.vercel.app
- API: https://project9-api.vercel.app/api
- Supabase project: `thkztqgjjtistluwyelv`
- Advisory service: https://project9-advisory.vercel.app

The initial database import contains 1,084 students (eight assessment demos and
1,076 Excel roster students), 1,081 accounts and 1,076 historical roster
allocations. The Excel students have no new assessment results. Their imported
training assignments remain separate from calculated selection results.

## Deployment configuration

The applications deploy as separate Vercel projects on Node 24 for the NestJS API
and Vite frontend, and the Python runtime for the FastAPI advisory service.
Vercel configuration files live in `apps/api`, `apps/web` and `services/ai`.
The initial deployment used clean staging directories containing source files,
not the local database, roster workbook, runtime snapshots or private backups.
Deployments currently use the CLI, not automatic GitHub deployments.

API production and preview environment variables:

- `DATABASE_URL`: Supabase transaction pooler, port 6543, with
  `pgbouncer=true`, `connection_limit=1`, `sslmode=require` and `schema=public`.
- `AUTH_REQUIRED=true` and a randomly generated `AUTH_TOKEN_SECRET`.
- A randomly generated server-only `INTEGRATION_API_KEY`.
- `PERSISTENCE_DRIVER=postgres`, `OFFICIAL_PROJECTION=true`.
- `STATE_FILE=/tmp/project9/runtime-state.json`.
- `DEMO_MODE=false`. Imported demo accounts/data remain available, while demo
  bootstrap and dependency simulation endpoints stay disabled.
- `WEB_ORIGIN=https://project9-college.vercel.app` (plus the team-scoped alias).
- `AI_SERVICE_URL=https://project9-advisory.vercel.app`.
- `ENABLE_FREEZE_SCHEDULER=false`. In-process timers cannot provide reliable
  scheduled execution on serverless hosting. A separately configured scheduler
  is still required for automatic freezes.

The frontend requires `VITE_API_URL=https://project9-api.vercel.app/api` at build
time. Redeploy it after changing that variable.

## Data protection and limitations

All imported public tables have row-level security enabled. Direct access for
Supabase `anon` and `authenticated` roles is revoked. Users access data through
the Project 9 authenticated API, not a browser-side Supabase client.

Passwords remain hashed. Student login still uses register number and the
requested temporary password. Replace shared temporary passwords before
general college use. Rotate any database password shared in chat.

The database restore and row-level security changes ran in one transaction
against the previously empty public schema. A private local database backup
remains outside the repository. Credentials and restore files must never enter
Git or a frontend bundle.

PostgreSQL runtime persistence avoids local filesystem writes, queues immutable
snapshots and awaits writes before successful HTTP responses. The legacy
whole-state runtime cache still needs concurrency redesign before high-volume
production use across multiple serverless instances. Authentication and the
official relational records use PostgreSQL directly.

Live partner integration acceptance for Projects 1, 2 and 8 remains separate
from deployment. Hosting does not supply missing student assessments.
