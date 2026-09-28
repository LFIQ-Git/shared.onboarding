# Neon Database

Every BRICK application reads and writes the same Neon Postgres database, `neondb` in the Neon project `lfiq-command`. The apps are separated by schema rather than by database. Understanding the schema map and the role model is the fastest way to stop guessing where data lives.

## The one-database model

The three-database model was retired in the 2026-05-17/18 consolidation. Anything that tells you Command, Intel, and leasing each have their own Neon database is out of date.

| Property | Value |
|----------|-------|
| Neon organization | `LFIQ - Neon` (`org-wandering-mode-53686477`) |
| Neon project name | `lfiq-command` |
| Neon project ID | `nameless-paper-46385107` |
| Branch | `main` (`br-muddy-butterfly-ara8m5xa`); a `ci-tests` branch also exists |
| Endpoint ID | `ep-hidden-union-aromj80p` |
| Region | AWS `us-west-2` |
| Postgres | 17 |
| Databases | `neondb` (every BRICK app), `healthchecks` (`brick-cron-monitor` only) |
| Direct host | `ep-hidden-union-aromj80p.c-4.us-west-2.aws.neon.tech` |
| Pooled host | `ep-hidden-union-aromj80p-pooler.c-4.us-west-2.aws.neon.tech` |

The same organization holds two more projects, `lfiq-apps` (`rapid-voice-40730355`) and `lfiq-home` (`delicate-smoke-15614378`), both in AWS `us-east-1`. The BRICK apps do not use them.

The project moved on 2026-09-07. The old project, `neon-claret-umbrella` (`morning-fire-74787570`, endpoint `ep-tiny-lab-akrddwgy`, org `org-cold-tree-71506959` "Vercel: LFIQ"), was replicated to `lfiq-command` and then deleted (verified 2026-09-28). Workers still pointed at it were repointed and their rows merged forward on 2026-09-11. Any DSN or config that still names `ep-tiny-lab-akrddwgy` is stale and fails with a password error. All 17 roles were recreated on `lfiq-command` with new passwords, which are in macOS Keychain as `com.justinsato.pkm.lfiq-command-<role>-password`.

The pooled host is transaction-mode PgBouncer. It drops session state, so a session `SET search_path` does not survive between transactions. Pools that rely on one must use the direct host; Command's Fly backend does this through `_session_host()` in `backend/app/db.py`.

Cloudflare Hyperdrive config `neondb-owner` (id `accfc5c90b364548a1b835abf46cae6e`, direct host, role `neondb_owner`, caching disabled) is bound as `HYPERDRIVE` on the Workers `brick-command`, `brick-hub`, `brick-intel`, `brick-keystone`, `brick-registry`, `brick-stacks` and `lfi-home` (added 2026-09-28). After a `neondb_owner` password rotation, run `wrangler hyperdrive update neondb-owner`.

Cross-schema joins are legal and used in production. Command's collections module joins `gdm.artenant` to `gdm.tenant`; Command's GDM read path queries the `gdm` schema from an app that otherwise lives in `portfolio`. Write the join, it is one database.

## Schema map

| Schema | Owner app | Holds | Tables (2026-09-27) |
|--------|-----------|-------|-------------|
| `items` | Intel | `inbox_items`, `tasks`, `commitments`, `decisions`, `entities`, `sources`, source-health materialized views | 49 |
| `gdm` | GDM extractor | Power BI Golden Data Model landing tables (`is_actuals`, `is_accttree`, `property`, `unit`, `artenant`, `tenant`, and the rest) | 72 |
| `portfolio` | Command | Property star schema: `properties`, `units`, `dim_*`, `fact_*`, `financials`, `mv_property_metrics`, `mv_portfolio_summary` | 141 |
| `market` | Leasing and competitor scrapers | `listings_current`, `cl_ads`, `sf_addresses`, `sf_parcels`, `etl_runs`, competitive-position views | 28 |
| `public` | Keystone (PKM) | `daily_briefing`, `agent_feed`, `agent_runs`, `agent_actions`, plus the shared extensions | 39 |
| `collect` | Command collections | `ar_snapshot`, `collection_month`, `collection_velocity`, `snapshot_run`, resident workflow tables | 12 |
| `repair` | Command repair | `wo_dispatch`, `dispatch_events`, `wo_costs`, `wo_invoices`, `wo_photos`, `wo_surveys`, `technicians` | 10 |
| `registry` | Registry | `deals`, `deal_parties`, `deal_events`, `deal_documents`, `loan_maturities`, `compliance_events` | 20 |
| `stacks` | Stacks | `parcels`, `signals`, `candidates`, `source_runs`, keyed on APN | 25 |
| `semantic` | Brick semantic index | `index_records`, `index_runs`, `query_events`, `sources` | 5 |
| `neon_auth` | Neon Auth (Stack Auth) | Managed identity tables. Apps never run DDL here | 9 |
| `drizzle` | Tooling | `__drizzle_migrations`, the legacy Drizzle journal, frozen after migration 0005 | 1 |

Five more schemas hold tables: `lfi` (98, owned by `lfi.home`), `civic` (24, used by `brick-watch` and the civic app), `facts` (7), `scores` (5) and `ops` (1). The `auth` schema exists as empty scaffolding from the Neon Data API integration. No application data lives in it.

Postgres extensions (`vector`, `pg_trgm`, `btree_gin`, `fuzzystrmatch`, `pgcrypto`, `pg_stat_statements`, `pg_session_jwt`) are installed in `public`, which is why `public` stays on every connection's `search_path`.

## Roles

| Role | Used by | Grants | Runs DDL |
|------|---------|--------|----------|
| `neondb_owner` | Migration runners only | Everything | Yes |
| `intel` | Intel, Registry, Stacks, Keystone runtime | `USAGE` plus `SELECT/INSERT/UPDATE/DELETE` on `items`, `registry`, `stacks`, `portfolio`, `market`, `semantic`, `public` | No |
| `command` | Command backend | Read/write on `portfolio`, `collect`, `repair`; read on `market`, `gdm`, `items` | No |
| `pkm` | Keystone runtime, MCP servers | Read/write on `public` and the PKM-owned `items` tables | No |

More scoped roles exist than this table lists: `intel_v2`, `registry`, `stacks`, `sticks`, `civic`, `gdm_extractor`, `market_scraper`, `lfi_app`, `lfi_invoice`, `lfiq_home`, `healthchecks` and others. `brick-intel` connects as `intel_v2` and `brick-watch` as `civic` since the 2026-09-11 repoint.

Two things to know before you assume the role model is airtight. First, per-app role enforcement is partially deferred: the `command`, `gdm_extractor`, and `market_scraper` roles are specified but several workloads still connect on `intel` or `neondb_owner`. Second, row-level security is enabled on 22 of the 39 tables in `public` and on no table in any other schema (checked 2026-09-27). Outside those tables, data ownership is enforced in the application layer through `dataset_scope` (`individual` / `common` / `admin`) plus `owner_email`, not by the database. Do not assume a query is scoped for you.

Isolation between apps in practice comes from `search_path`, set on every connection acquire, not from role grants.

## Connection strings

Connection strings come from Neon. They are stored as Worker secrets on Cloudflare and as `flyctl secrets` on Fly, never in a repo. Never paste a DSN into a ticket, a commit, or a chat.

| Env var | Host type | Label in `data-connections.md` | Used by |
|---------|-----------|-------------|---------|
| `DATABASE_URL` | Pooled | `items-hub-database-url` | Intel, Keystone, Registry, Stacks at runtime |
| `DATABASE_URL_UNPOOLED` | Direct | `intel-neon-database-url` | drizzle-kit, migration runners, `psql` sessions |
| `BRICKSTON_DATABASE_URL` | Direct | `command-database-url-direct` | Command backend, `portfolio` pool |
| `BRICKSTON_ITEMS_HUB_DATABASE_URL` | Pooled | `items-hub-database-url` | Command backend reading `items` and `gdm` |
| `BRICKSTON_LEASING_INTEL_DATABASE_URL` | Pooled | `intel-neon-database-url` | Command backend reading `market` |
| `BRICKSTON_KEYSTONE_DATABASE_URL` | Pooled | `pkm-database-url` | Command writing to `public.agent_*` |
| `LEASING_DATABASE_URL_UNPOOLED` | Direct | Fly secret on `brick-leasing-etl` | Leasing and competitor scrapers writing `market` |

The labels are old secret names kept only so the two docs line up. Pull the actual string for the role you need from Neon. Dead names you will still find in old docs and should not use: `brickston-database-url` (the retired pre-Neon database), `brickston-database-url-neon` (the retired standalone `brickston` Neon database).

Pull a connection string from Neon, either through the Neon MCP or the Neon console (project `lfiq-command`, **Connect**):

```text
get_connection_string(project_id='nameless-paper-46385107', roleName='command')
```

That returns the pooled string. Remove `-pooler` from the host for the direct string. The Keychain entries older notes name for DSNs (`com.justinsato.pkm.command-database-url-direct` and its siblings) do not exist.

## Pooled versus unpooled

The pooled host has `-pooler` in the hostname. The direct host does not. Pick by workload, not by habit.

| Use pooled for | Use direct for |
|----------------|----------------|
| Application runtime, serverless functions, short queries | Migrations and any DDL |
| Anything running on Cloudflare Workers, where connection count is unpredictable | `CREATE INDEX CONCURRENTLY`, which cannot run inside a pooled transaction |
| High-frequency reads from a long-lived pool | Long transactions, bulk loads, one-shot scripts |
| Anything where you would otherwise exhaust the direct connection limit (`max_connections` read 901 on 2026-09-27; it scales with compute size) | Interactive `psql` |

Failure modes worth recognizing:

- An empty `DATABASE_URL_UNPOOLED` silently falls back to a dead local socket. If a migration script reports "connection refused" on localhost, the unpooled variable is unset. Use the pooled URL to unblock, then fix the variable.
- Neon's proxy silently drops the `search_path` startup parameter on both hosts. Applications re-apply it in a connection setup callback (asyncpg `setup=`, or a `SET search_path` on acquire). If you write a raw script, set it yourself or fully qualify every table name.
- Registry and Stacks are documented as pooled-only. Do not point them at `DATABASE_URL_UNPOOLED`.

## Cold starts

Neon suspends an idle compute after roughly five minutes. The first query after suspension takes 30 to 60 seconds while the compute wakes. This is not a bug and it is not your query plan.

Anything with a fixed timeout under 60 seconds will fail on a cold endpoint. The Items Hub promote script has a 40-second timeout and fails this way regularly. Warm the endpoint, then rerun:

```bash
psql "$DATABASE_URL" -c "select 1;"
# wait for it to return, then run the real job
```

## Connecting locally

```bash
# Direct host, for schema work
psql "$DATABASE_URL_UNPOOLED"

# Pooled host, to reproduce what the app sees
psql "$DATABASE_URL"

# Inspect the schema map
psql "$DATABASE_URL" -c "\dn"

# Row counts for one schema
psql "$DATABASE_URL" -c "
  select relname, n_live_tup
  from pg_stat_user_tables
  where schemaname = 'items'
  order by n_live_tup desc
  limit 20;"
```

Ports 5433 and 5434 appear in older setup notes. Nothing on the Mac listens on 5433 now, and neither port is Neon. The local Postgres containers that exist belong to the Back9 dev stack and home automation. Neon is always reached over TLS on 5432 at the hostnames above.

## Running migrations

Each app owns its own migration mechanism. There is no fleet-wide runner.

| App | Migration files | Command | Tracking |
|-----|-----------------|---------|----------|
| Intel | `drizzle/migrations/*.sql` | `npm run db:migrate` (runs `drizzle/migrate.ts`) | `items.sql_migrations` |
| Registry | `drizzle/migrations/*.sql` | `npm run db:migrate` (psql loop) | filename order |
| Stacks | `drizzle/migrations/*.sql` | `npm run db:migrate` | filename order |
| Keystone | `automation/migrations/*.sql` | `npm run migrate-db` (runs `automation/scripts/apply_migrations.py`) | none in-database; supports `--from NN` to resume |
| Command | `backend/database/migrations/NNN_*.sql` | `python -m jobs.run_migration` | `schema_migrations_cloud_run`, with a SHA-256 drift check |

Migrations are hand-written SQL in every repo. The Drizzle journal in the `drizzle` schema is frozen at index 4 and is not the source of truth anywhere.

Apply a single Command migration against production, without echoing the DSN:

```bash
# DSN holds the direct lfiq-command string for the owner role, pulled from Neon
psql "$DSN" -v ON_ERROR_STOP=1 -f backend/database/migrations/053_example.sql
```

Rules for new migrations:

1. Number sequentially, never renumber an applied file. Command's runner rejects filenames outside `^\d{3}_[a-z0-9_]+\.sql$` and detects content changes by hash.
2. Run against the direct host. `CREATE INDEX CONCURRENTLY` fails on the pooler.
3. Set `search_path` explicitly at the top of the file or fully qualify every object.
4. Grant to the app role in the same migration that creates the table. Registry does this and it is the reason its tables work without a follow-up grant pass.

## The jsonb double-encode trap

Both `postgres.js` (TypeScript) and `asyncpg` (Python) will double-encode a value you have already serialized. Passing `${JSON.stringify(obj)}::jsonb` stores a JSON *string* scalar, not an object. The symptom is `jsonb_typeof(col)` returning `string` or `array`, and every `col->>'key'` returning null.

Pass the raw object and let the driver encode it, or build the value in SQL:

```sql
-- safe
insert into items.tasks (metadata)
values (jsonb_build_object('source', $1::text, 'priority', $2::int));
```

A standing guard runs after the Brick sweep and raises a data-corruption card if this ever recurs:

```sql
select count(*) from items.tasks where jsonb_typeof(metadata) <> 'object';
```

## Where to get help

- [Architecture](/docs/architecture) for how the schemas fit into the app family
- [Neon Debugging](/docs/neon-debugging) for connection and query troubleshooting
- [Fly.io Backend](/docs/fly-io-backend) for the jobs that write `gdm` and `portfolio`
- [Getting Started: Setup](/docs/getting-started/setup) for first-run credential setup
- Ask Justin before running anything that mutates production data. The `ci-tests` branch exists for tests; there is no staging copy of `neondb`.
