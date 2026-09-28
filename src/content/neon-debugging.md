# Neon Debugging

Everything runs against one Neon database, `neondb`, split by schema. Most database problems here are not query bugs. They are the wrong connection string, a suspended endpoint, a missing RLS policy, or a schema you forgot to qualify.

## Triage table

| What you see | Go to |
|--------------|-------|
| `could not connect to server: /tmp/.s.PGSQL.5432` | [Connection strings](#connection-strings) |
| Auth fails on a DSN that looks correct | [Connection strings](#connection-strings) |
| `subprocess.TimeoutExpired` on the first query of a run | [Cold starts and timeouts](#cold-starts-and-timeouts) |
| A page hangs for 40 seconds then loads fine on retry | [Cold starts and timeouts](#cold-starts-and-timeouts) |
| A query returns zero rows with no error, but the data is there | [Roles, grants, and RLS](#roles-grants-and-rls) |
| `permission denied for schema` on a migration | [Roles, grants, and RLS](#roles-grants-and-rls) |
| The Neon console shows no tables | [Schemas and search_path](#schemas-and-search-path) |
| Unqualified table names resolve in one job and fail in another | [Schemas and search_path](#schemas-and-search-path) |
| A test expects a constraint the database does not have | [Migrations](#migrations) |
| You need to prove what is actually stored | [Inspecting the database](#inspecting-the-database) |

## The layout you are debugging against

| Fact | Value |
|------|-------|
| Neon project | `lfiq-command` (`nameless-paper-46385107`), org `LFIQ - Neon` |
| Database | `neondb` |
| Endpoint | `ep-hidden-union-aromj80p`, us-west-2 |
| Pooled host suffix | `-pooler.c-4.us-west-2.aws.neon.tech` |
| Owner role for DDL | `neondb_owner` |

| Schema | Owns |
|--------|------|
| `items` | Intel ingest, inbox, tasks, commitments, decisions, entities, knowledge graph, observations |
| `portfolio` | Command portfolio star schema, properties, units, financials |
| `gdm` | Power BI Golden Data Model extract, the authoritative financial source |
| `market` | Leasing and competitor intel |
| `collect` | Collections and AR aging workflow |
| `repair` | Work orders, dispatch, costs |
| `registry` | Deals, parties, deal events, compliance events |
| `stacks` | SF sourcing parcels, overrides, app settings |
| `public` | PKM tables plus the shared extensions (`vector`, `pg_trgm`, `btree_gin`, `fuzzystrmatch`, `pgcrypto`) |
| `semantic` | Shared semantic index records and query events |
| `neon_auth` | Neon Auth managed identity tables |
| `lfi` | `lfi.home` advisory business and tax tables |
| `civic` | Civic and watch notices |

Cross-schema joins are valid SQL. It is one database.

## Connection strings

Every app carries both a pooled and a direct DSN. The rule: pooled for app runtime, direct for migrations, `CREATE INDEX CONCURRENTLY`, and long transactions.

### Symptom: `psql` fails against the local socket `/tmp/.s.PGSQL.5432` on a machine that runs no local Postgres

**Cause:** the script read `DATABASE_URL_UNPOOLED`, which is empty in Intel's `.env.local`, and passed an empty string to `psql`. `psql` with no connection string falls back to the local socket. The failure names a database that does not exist on the box, which is the tell.

**Fix:** fall back to the pooled URL when the unpooled one is blank.
```bash
DB_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
[ -z "$DB_URL" ] && { echo "no DSN available"; exit 1; }
psql "$DB_URL" -c "select 1"
```

**How to confirm it worked:** `psql "$DB_URL" -c "select current_database(), current_user"` returns `neondb` and the scoped role, not an error naming a socket path.

### Symptom: a DSN pulled from production auth-fails, or the connection string appears to contain quote characters

**Cause:** in production, `DATABASE_URL_UNPOOLED` is stored as the owner URL wrapped in literal quote characters. Runtime code that reads it verbatim sends the quotes as part of the host string.

**Fix:** use the pooled URL at runtime and strip stray quotes defensively.
```ts
const dsn = (process.env.DATABASE_URL || "").trim().replace(/^['"]|['"]$/g, "");
```

**How to confirm it worked:** the app connects and `select current_user` returns the scoped role rather than `neondb_owner`.

### Symptom: Registry cannot connect on the unpooled endpoint

**Cause:** the unpooled endpoint has known auth problems on this Neon project. Registry is wired to the pooled DSN only.

**Fix:** set Registry's `DATABASE_URL` to the pooled DSN. Do not add `DATABASE_URL_UNPOOLED` to that project.

**How to confirm it worked:** `npm run db:migrate` and app reads both succeed on the pooled host.

### Pulling a DSN

Pull it from Neon, through the Neon MCP or the Neon console (project `lfiq-command`, **Connect**):

```text
get_connection_string(project_id='nameless-paper-46385107', roleName='<role>')   # pooled
```

Remove `-pooler` from the host for the direct string. Never paste a DSN into chat, an issue, or a commit.

### Symptom: writes succeed but no other app sees the rows

**Cause:** the app's DSN still points at the retired `ep-tiny-lab-akrddwgy` endpoint in the old Neon organization. That project (`morning-fire-74787570`) has since been deleted, so the same mistake now fails outright with a password error (verified 2026-09-28). `brick-intel` and `brick-watch` did this until 2026-09-11, and three days of Intel writes had to be merged forward.

**Fix:** repoint the secret at `ep-hidden-union-aromj80p` with the app's scoped role.

**How to confirm it worked:** `select current_user` through the app returns the scoped role, and the new rows appear when you query `lfiq-command` directly.

## Cold starts and timeouts

### Symptom: `subprocess.TimeoutExpired` on the first query of a scheduled run, and the same command works when you run it by hand a minute later

**Cause:** the Neon endpoint was suspended. The first query pays the cold-start cost, which runs 30 to 60 seconds. A job with a 40 second per-query timeout dies on the first query and never gets to the fast second one. This is a per-cold-start operational quirk, not a code bug.

**Fix:**
```bash
psql "$DATABASE_URL" -c "select 1"   # takes 30-60s cold, returns fast after
# then rerun the job
```

**How to confirm it worked:** the second invocation of the same job completes in normal time.

### Symptom: an observations page hangs for 40 or more seconds then loads

**Cause:** the same cold start, or an unindexed scan. The heaviest known statements on this database are `portfolio.refresh_financials_from_gdm()`, unindexed `items.inbox_items` `payload::text ILIKE '%...%'` searches, and correlated COUNT subqueries in the inbox list.

**Fix:**
1. Warm the endpoint as above.
2. If it repeats when warm, profile it. `pg_stat_statements` is enabled on `neondb`.
   ```sql
   SELECT calls, round(mean_exec_time)::int AS mean_ms, left(query, 120) AS query
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 15;
   ```
3. Replace `payload::text ILIKE` scans with a jsonb path predicate or an index.

**How to confirm it worked:** the same page loads under a second on a warm endpoint, and the statement drops out of the top of `pg_stat_statements`.

## Roles, grants, and RLS

### Symptom: a role with a valid GRANT sees zero rows, and no error is raised

**Cause:** Row-Level Security is enabled on the table and that role has no policy. A grant alone is not enough. Postgres silently returns nothing. This hit the `intel` role on `public.agent_feed`, then again on `public.agent_runs` and `public.agent_actions`, where only `pkm_all` policies existed. Hub's status page read through the `intel` role and showed an empty pipeline that was in fact running.

**Fix:** add a policy for the role, applied as `neondb_owner`.
```sql
-- write access
CREATE POLICY intel_all ON public.agent_feed FOR ALL TO intel USING (true) WITH CHECK (true);
-- read-only
CREATE POLICY intel_read ON public.agent_runs   FOR SELECT TO intel USING (true);
CREATE POLICY intel_read ON public.agent_actions FOR SELECT TO intel USING (true);
```

**How to confirm it worked:**
```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'agent_feed';
SELECT polname, polroles::regrole[], polcmd FROM pg_policy
WHERE polrelid = 'public.agent_feed'::regclass;
```
Then read the table as the scoped role and get a nonzero count.

### Symptom: `permission denied` running a migration through the repo's migration runner

**Cause:** the repo's `db:migrate` connects as the least-privilege app role. Owner-only DDL, including RLS policy creation, cannot run there.

**Fix:** apply owner-level DDL as `neondb_owner`, either through the Neon MCP or with the direct owner DSN.
```bash
psql "$OWNER_DSN" -f drizzle/migrations/0001_registry_schema.sql
```

**How to confirm it worked:** re-run the app-role migration runner and it reports nothing to apply, and the object exists in `information_schema`.

## Schemas and search_path

### Symptom: the Neon console table browser shows nothing and you conclude the data is missing

**Cause:** the console defaults to the `public` schema. Intel writes only under `items`.

**Fix:** switch the schema dropdown, or qualify the table.
```sql
SELECT count(*), min(received_at), max(received_at)
FROM items.inbox_items WHERE source = 'smartsheet';
```

There is no per-source table. All 14 sources converge into `items.inbox_items` and are separated only by the `source` text column.

**How to confirm it worked:** the count is nonzero and `max(received_at)` is recent.

### Symptom: unqualified table names resolve in one process and fail in another against the same database

**Cause:** `search_path` is the isolation mechanism, and it is set per connection. Neon's proxy drops the `search_path` startup parameter, and asyncpg's connection reset clears a one-time `SET`. A pool that sets it once at creation loses it on the next acquire.

**Fix:** set `search_path` in the pool's `setup` callback so it runs on every acquire.
```python
async def _setup(conn):
    await conn.execute("SET search_path TO portfolio, public")

pool = await asyncpg.create_pool(dsn, setup=_setup)
```
For DSN-scoped jobs, put it on the connection string instead:
```
...&options=-csearch_path%3Dmarket%2Cpublic
```
Keep `public` on the path in every case so extension types and operators resolve.

**How to confirm it worked:**
```sql
SHOW search_path;
```
Run it through the pool, not a fresh psql session, and confirm it holds across two consecutive acquires.

### Symptom: a query that should join Intel and portfolio data fails or is split across two round trips in app code

**Cause:** leftover assumptions from the pre-consolidation, one-pool-per-database era.

**Fix:** join directly. `portfolio.financials` to `gdm.is_actuals`, `portfolio.properties` to `market.listings_current`, all in one query.

**How to confirm it worked:** the join runs in a single statement and the app-level merge code can be deleted.

## Migrations

### Symptom: a test asserts a `CHECK` constraint that the live table does not have, and unexpected values insert without complaint

**Cause:** schema drift between the migration history and the live database. `items.observations` has no `CHECK` on `kind`, so unknown kinds insert fine even though the test suite expects rejection.

**Fix:** decide which side is right, then reconcile. Either add the constraint as `neondb_owner` after auditing existing values, or relax the test. Do not leave the two disagreeing.
```sql
SELECT kind, count(*) FROM items.observations GROUP BY kind ORDER BY 2 DESC;
```

**How to confirm it worked:** `information_schema.check_constraints` lists the constraint, or the test no longer asserts one.

### Symptom: a new table works for the owner but not the app role

**Cause:** the grant did not follow the table. On Neon, default privileges do auto-grant the scoped role on new tables in a schema it already owns, which is why this sometimes works without action, and identity columns on PG15 need no separate sequence grant. When it fails, the default privileges were never set for that schema.

**Fix:**
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stacks TO stacks;
ALTER DEFAULT PRIVILEGES IN SCHEMA stacks
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stacks;
```

**How to confirm it worked:** `SELECT has_table_privilege('stacks', 'stacks.parcel_overrides', 'SELECT');` returns true.

## Inspecting the database

Use these to prove what is stored rather than what the UI claims.

```sql
-- what is in the inbox, by source
SELECT source, count(*), max(received_at)
FROM items.inbox_items
GROUP BY source ORDER BY 2 DESC;

-- ingest run telemetry, including swallowed errors
SELECT source, trigger_env, records_ingested, completed_at, error
FROM items.source_runs
ORDER BY completed_at DESC LIMIT 20;

-- source health config drift
SELECT source, status, enabled, trigger_env, cadence, next_expected_run
FROM items.source_config ORDER BY source;

-- double-encoded jsonb audit (see the Common Errors page)
SELECT count(*) FROM items.tasks
WHERE metadata IS NOT NULL AND jsonb_typeof(metadata) <> 'object';

-- duplicate-observation import chain
SELECT count(*) FROM items.observations
WHERE metadata->>'dedupe_key' LIKE 'items_hub:%';

-- who am I connected as, and where
SELECT current_database(), current_user, inet_server_addr();
SHOW search_path;
```

If a count is greater than zero but a dashboard card looks dead, the ingest is fine and the downstream extractor is the suspect. Check for rows where `processed_at IS NULL`.

## Related pages

- [Common Errors](/docs/common-errors)
- [Neon Database](/docs/neon-database)
- [Cloudflare Debugging](/docs/cloudflare-debugging)
- [Architecture](/docs/architecture)
- [Intel](/docs/apps/intel)
