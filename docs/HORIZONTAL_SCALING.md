# Horizontal scaling

## Application protocol

`HORIZONTAL_STATE=true` switches production away from the whole `RuntimeState`
snapshot. Start-up fails unless PostgreSQL and the completed cutover marker exist.
Never run old snapshot writers and horizontal writers simultaneously.

- `SharedStateRecord` stores compatibility/advisory entities independently by
  namespace/key, with a version for optimistic concurrency. Official student,
  account, score, ranking, allocation and snapshot tables remain relational.
- Each relevant request loads only the required namespaces/keys into its own
  AsyncLocalStorage context. No process-global authoritative student/advisory
  cache, local state file, sticky session or process mutex is used in this mode.
- Deltas—not complete snapshots—are committed. Conflicting entity changes return
  409 rather than overwriting another replica. History is append-only. A unique
  partial index permits only one pending recommendation per student/cycle.
- Coordinated mutations share one SQL transaction across Nest modules. Nested
  service transactions join it. Recommendation approval, official allocation,
  capacity and advisory metadata therefore commit or roll back together.
- Selection, allocation, rules, weights and freeze mutations lock the affected
  cycle, not the entire application. Different cycles and ordinary profile reads
  remain independent. A lock wait is bounded to eight seconds.
- Imports use transaction-scoped idempotency locks, a canonical payload hash and
  a stored response. Identical retries replay the response across replicas;
  changed payloads or legacy unverified keys return 409 and require a new key.
- PostgreSQL atomically enforces combined IP/account rate limits across replicas.
  Identifiers are HMAC-hashed with the existing private signing secret. Expired
  buckets are cleaned in bounded `SKIP LOCKED` batches. Protection fails closed
  with 503 if the shared limiter cannot run; it never silently becomes local.
- One global Prisma provider supplies one pool per API process. Credentials,
  accounts and token revocation state are already database-backed.

## Controlled cutover

1. Pass typechecking, all API tests and `horizontal-scaling.e2e-spec.ts` against
   an isolated local `project9_*test*` database. Those tests launch two independent
   OS processes and exercise cross-replica imports, conflicting writes, shared
   limits, transaction rollback, selection, approvals and freeze execution.
2. Deploy the additive schema migration once (not per container start). It does
   **not** automatically copy the snapshot while old writers remain active.
3. Build one immutable candidate image containing both modes. Deploy it with
   `HORIZONTAL_STATE=false,MAINTENANCE_WRITES=true`, min zero and max one. Verify
   readiness and shift all traffic to this write-paused revision. Check every
   tagged old revision; do not leave an alternate old writer accessible.
4. Drain requests from old writers for at least the previous request timeout
   (currently 300 seconds), and verify no legacy scheduler/out-of-band writer
   remains. Reads stay available. Login/new writes return 503 during this pause.
5. With the private DATABASE_URL supplied through the environment, run
   `node scripts/cutover-horizontal-state.cjs --check`, then set
   `PROJECT9_WRITES_QUIESCED=true` and run the same script with `--import`.
   It locks the source, validates duplicates, copies every entity atomically,
   verifies counts and records the source digest. The original snapshot remains.
6. Deploy/health-check the same digest with `HORIZONTAL_STATE=true` and
   `MAINTENANCE_WRITES=false`. Shift traffic, verify authenticated reads, import
   history and pending recommendations. Mutate only the isolated synthetic demo
   during live checks; compare real-cycle table hashes before/after.
7. Set service-level and revision-level max two only after authorization and
   successful cutover. Keep min zero and session affinity disabled. With a
   ten-connection pool, budget at least twenty API client connections for two
   serving instances, plus transient deployment/migration connections.
   API request concurrency is 20 per instance to avoid excessive per-pool
   queueing on the cross-region database connection.

Rollback after cutover must preserve new state: pause/drain writes again and use
`--export-for-rollback` before routing to a legacy snapshot writer. Image rollback
alone does not restore or migrate data. Prefer another horizontal-compatible
revision instead. No migration automatically deletes student or selection data.

## Boundaries

This is multi-instance safety, not unlimited capacity or a cloud load-test SLA.
Transactions are bounded to 120 seconds; same-cycle decisions are intentionally
serialized. Oversized administrative imports/advisory runs may need smaller
batches. Long operations remain synchronous: there is no durable automatic
queue/retry worker, and request completion is not guaranteed after disconnect or
process termination. PostgreSQL rolls uncommitted work back; callers retry using
the same import idempotency key. The existing external fetch lease protocol is
unchanged. Scheduled work must not rely on an in-process timer when Cloud Run
scales to zero.

Before increasing beyond two instances, measure database/pool saturation, CPU,
p95 latency and errors with representative cloud traffic; size pools and budgets
together. Compatibility list/agent paths still load entire relevant namespaces;
high-volume history and advisory workloads need paginated direct repositories and
durable chunked jobs. Supabase remains the shared database bottleneck/failure
domain. Database HA/PITR, externally delivered scheduled jobs, a WAF and production
SLO/alerting are separate operational work, not implied by autoscaling. Min zero
reduces idle cost but can cold-start; maximum instance settings are not a hard
spending limit or a guarantee of free hosting.
