# Intel App Guide

Intel is the data convergence hub for LFIQ. It ingests observations from a registry of 27 external sources, enriches them with a knowledge graph, and surfaces them through an inbox interface.

## What It Does

Intel aggregates operational intelligence from across the LFIQ ecosystem:
- **Observations inbox:** New data points from M365 (both tenants), Granola, Zoom, Smartsheet, SharePoint report imports, SF Open Data, Craigslist, Power BI, connected file accounts, market news, and the Command portfolio scans
- **Knowledge graph:** Edges linking observations to properties, deals, contacts, and market conditions
- **Semantic search:** `/api/search` calls the semantic API on `brickston-backend` (`BRICK_SEMANTIC_API_URL`)
- **Data enrichment:** Automatic linking of related observations, resolution of references
- **Alerts:** Notifications of high-priority observations (delinquency, rent spikes, lease expirations)

**Primary features:**
- Observation inbox (priority-ranked)
- Semantic search
- Knowledge graph browser
- Property override editing (manual data corrections)
- Data accuracy monitoring

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://intel.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-intel` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |
| **Local Worker** | http://localhost:3001 | Via `npm run dev:vinext` | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 16 | React 19, App Router, built for Workers with vinext |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Cloudflare Access | Middleware verifies the Access JWT. The `intel` grant in `items.auth_allowed_users` is checked on `/login`, `/profile` and in-route gates. `/api/*` is public in middleware |
| **Database** | Neon (items schema) | Observations, knowledge graph |
| **Search** | `brickston-backend` semantic API | Via `BRICK_SEMANTIC_API_URL` |
| **External APIs** | 27 registered sources | 24 live, 3 down (Yardi, DocuSign, a retired local file drop) |
| **Ingest Pipeline** | Cloudflare cron triggers in `wrangler.toml` | `worker/cron-routes.ts` maps each schedule to a route. Schedules run from every 5 min to weekly |
| **Deployment** | Cloudflare Workers | Workers Builds on push to main |

## Local Development

### Start the App

```bash
git clone https://github.com/LFIQ-Git/brick.intel.git
cd brick.intel
npm run dev
# Runs on http://localhost:3000

# Or run it as a local Worker
npm run dev:vinext
# Runs on http://localhost:3001
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `DATABASE_URL` | Yes | Neon connection, pooled (items schema, intel role) |
| `DATABASE_URL_UNPOOLED` | No | Direct connection, for `drizzle-kit` migrations only |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `true` to bypass the Access gate |
| `INGEST_SECRET` | Yes | Authorizes manual cron invocation and inbound ingest |
| `ANTHROPIC_API_KEY` | No | Claude for observation enrichment |

For local dev, put secrets in `.dev.vars` (template: `.dev.vars.example`). Production secrets are Worker secrets: `npx wrangler secret list --name brick-intel` lists the names, `npx wrangler secret put <NAME> --name brick-intel` sets one. Never put a secret in `wrangler.toml`.

## Data Sources (27 Registered, 24 Live)

The registry is `brick.intel/app/lib/sources.ts`. It is the source of truth for what exists, on what cadence, and whether it is live. The live surface is `intel.lfiq.app/sources`.

### Incoming Integration Details

| Source | Cadence | Trigger | Purpose | Status |
|--------|---------|---------|---------|--------|
| **M365, lfiq tenant** | Every 4h | Cloudflare cron | Email, calendar | Live |
| **M365, Mosser tenant** | Every 4h | Cloudflare cron | Email, calendar | Live |
| **SharePoint report imports** | Every 2h | Cloudflare cron | Yardi report workbooks | Live |
| **Outlook contacts** | Every 4h (with M365) | Cloudflare cron | Contact records | Live |
| **Granola** | Every 6h | Cloudflare cron | Meeting transcripts | Live |
| **Zoom** | Every 6h | Cloudflare cron | Meeting transcripts | Live |
| **Connected file accounts** | Every 6h | Cloudflare cron | Box, Dropbox, Google Drive | Live |
| **Google Gmail and Calendar** | Every 6h | Cloudflare cron | Connected personal accounts | Live |
| **Market news (RSS)** | Every 6h | Cloudflare cron | Real-estate press | Live |
| **Listing alerts** | On email | Cloudflare cron | Apartments.com, Zillow alerts routed by subject | Live |
| **Smartsheet** | 08:00 UTC daily | Cloudflare cron | Project tracking, tasks | Live |
| **Teams chat takeaways** | On email | Cloudflare cron | Daily takeaways routed by subject | Live |
| **SF Open Data** | 6:30 AM daily | Fly batch job | Assessor records, APN, permits | Live |
| **Craigslist SF rentals** | 5:30 AM daily | Fly batch job | Competitor listings | Live |
| **Power BI** | 18:30 UTC daily | Fly `brick-cron`, label `gdm-extractor` | Golden Data Model | Live |
| **Brickston portfolio scans** | Daily | Fly batch jobs | AR events, notice-to-vacate, vendor COI, permits, code violations | Live |
| **Yardi** | n/a | None | Direct PM-system pull. There is no Yardi API access on our side | Down |
| **DocuSign** | n/a | None | Not wired | Down |

The registry marks the batch-job triggers `fly`. The jobs run on Fly `brick-cron`. One retired entry, `brickston-leases`, still carries its pre-Fly trigger label.

### How Ingest Works

1. **A Cloudflare cron trigger** fires `scheduled()` in `worker/index.ts`, which calls the mapped Intel route with `Bearer CRON_SECRET`, or a batch job on Fly `brick-cron` posts in
2. **The route** validates the caller (`Bearer CRON_SECRET`, `x-ingest-secret`, or `?secret=`), then transforms the payload
3. **Insert into `items.inbox_items`** with source, timestamp, payload, and an idempotency key so a no-op upstream save does not re-ingest
4. **Log the run** into `items.source_runs` and flip `items.source_config.status` to `live`
5. **Extractor and edge builder crons** promote raw rows into tasks, commitments and knowledge edges
6. **Index for semantic search** through the `brickston-backend` semantic API

There is no per-source table. Every source converges on `items.inbox_items` and is separated only by the `source` column.

Example flow for a Smartsheet row:
```
Smartsheet API
  ↓
Cloudflare cron → GET /api/ingest/smartsheet   (0 8 * * *)
  ↓
INSERT INTO items.inbox_items (source='smartsheet', payload, idempotency_key)
  ↓
Cloudflare cron → /api/extract                 (*/15 * * * *)
  ↓
Cloudflare cron → /api/cron/extract-edges      (0 * * * *)
  ↓
INSERT INTO items.knowledge_edges (source_id, target_id)
  ↓
Index in the semantic API (brickston-backend)
```

## Key Flows

### Flow 1: New Observation Arrives
1. External source sends data (e.g., Smartsheet, M365)
2. The cron route validates the caller and inserts into `items.inbox_items`
3. The edge-refresh cron links the observation to properties and deals
4. Record indexed in the semantic API
5. Intel UI updates on the next load
6. If priority > threshold, Brick chat sends notification

### Flow 2: User Acknowledges Observation
1. User clicks observation in Intel inbox
2. UI toggles `acknowledged` flag in database
3. Observation remains in inbox but marked as read
4. If actionable, user can create task in Command or Registry

### Flow 3: Semantic Search
1. User enters search query in Intel search box
2. `/api/search` forwards the query to the semantic API on `brickston-backend`
3. The UI displays the results

## Environment Variables

| Variable | Required? | Default | Purpose |
|----------|-----------|---------|---------|
| `DATABASE_URL` | Yes | n/a | Neon connection string, pooled (intel role) |
| `DATABASE_URL_UNPOOLED` | No | n/a | Direct connection for `drizzle-kit` only |
| `BRICK_AUTH_DISABLED` | No | n/a | Local dev bypass |
| `INGEST_SECRET` | Yes | n/a | Authorizes manual cron runs and inbound ingest |
| `CRON_SECRET` | Yes | n/a | Bearer token accepted by cron routes |
| `BRICK_SEMANTIC_API_URL` | No | n/a | Semantic search API base. Falls back to `BRICKSTON_BACKEND_URL`. Unset means `/api/search` returns 503 |
| `ANTHROPIC_API_KEY` | No | n/a | Claude API key (enrichment) |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_REFRESH_TOKEN` | No | n/a | Delegated Microsoft Graph token for the report-import cron. Roughly 90-day expiry, rotates on use |
| `REPORTS_INBOUND_SECRET` | No | n/a | Bearer token for the inbound email report route |

## Troubleshooting

### Issue 1: "Observations not appearing in inbox"
**Symptom:** Inbox is empty or stale data from days ago  
**Cause:** A cron run failed, the Neon connection dropped, or the extractor is behind  
**Fix:**
```bash
# Start at the source health page
open https://intel.lfiq.app/sources

# Confirm in SQL. The Neon console defaults to `public`, so qualify the schema
psql "$DATABASE_URL" -c \
  "SELECT source, count(*), max(received_at) FROM items.inbox_items GROUP BY source ORDER BY 3 DESC;"

# Check the run log for the source that looks stuck
psql "$DATABASE_URL" -c \
  "SELECT source, completed_at, records_ingested, error FROM items.source_runs ORDER BY completed_at DESC LIMIT 20;"

# Re-run a cron by hand. Every cron route accepts the ingest secret
curl "https://intel.lfiq.app/api/ingest/smartsheet?secret=$INGEST_SECRET"

# Dry run first if you only want to see what it would pull
curl "https://intel.lfiq.app/api/cron/graph-report-imports?dryrun=1&secret=$INGEST_SECRET"
```

### Issue 2: "Database connection timeout on observations query"
**Symptom:** "Observations" page hangs for 40+ seconds  
**Cause:** Neon cold start or slow query  
**Fix:**
```bash
# Warm connection
psql "$DATABASE_URL" -c "SELECT 1 FROM items.inbox_items LIMIT 1;"

# Reload page
```

### Issue 3: "Semantic search returns no results"
**Symptom:** Search box works but no results shown  
**Cause:** The semantic API is not configured on the Worker (the route answers 503), or records were never indexed  
**Fix:**
```bash
# Check the secret name is set
npx wrangler secret list --name brick-intel | grep BRICK_SEMANTIC_API_URL

# Re-run the extractor, which is what writes embeddings
curl "https://intel.lfiq.app/api/extract?source=items-inbox&limit=50&secret=$INGEST_SECRET"
```

### Issue 4: "Signed in but the dashboard is empty, or you get bounced to /login"
**Symptom:** Access login succeeds but Intel shows no data, or the middleware redirects you  
**Cause:** Your `items.auth_allowed_users` row does not include `intel`. Middleware only verifies the Access identity; the in-route gates read the allowlist, so an unprovisioned user can load the shell with no data  
**Fix:**
```bash
# Ask a brick_admin to add the intel grant through Command /admin/users
```

## Common Tasks

### Task 1: Query Observations Directly
```sql
-- Count observations by source
SELECT source, COUNT(*) 
FROM items.inbox_items 
GROUP BY source
ORDER BY COUNT(*) DESC;

-- Find recent high-priority observations
SELECT id, source, created_at, payload
FROM items.inbox_items
WHERE priority > 7
ORDER BY created_at DESC
LIMIT 20;

-- Search observations by property APN
SELECT *
FROM items.inbox_items
WHERE payload->>'property_apn' = '0123-456-789'
ORDER BY created_at DESC;
```

### Task 2: Trigger a Manual Ingest Run
Every cron route is an HTTP endpoint that accepts the ingest secret, so there is no job runner to invoke.

```bash
# Smartsheet (scheduled 08:00 UTC daily)
curl "https://intel.lfiq.app/api/ingest/smartsheet?secret=$INGEST_SECRET"

# M365 Graph pull (scheduled every 4h)
curl "https://intel.lfiq.app/api/cron/graph-pull?secret=$INGEST_SECRET"

# SharePoint report imports (scheduled every 2h). Add dryrun=1 to inspect without writing
curl "https://intel.lfiq.app/api/cron/graph-report-imports?secret=$INGEST_SECRET"
```

Fly batch jobs are triggered differently, by crontab label:
```bash
flyctl ssh console -a brick-cron -C "/app/run-job.sh <label> <command...>"
# The label and command for each job are the lines in the brick-cron crontab
```

### Task 3: Add a New Data Source
To integrate a new external data source into Intel:

1. Add the source to `app/lib/sources.ts` with its cadence, tenant, and alert threshold
2. Write the ingest route under `app/api/ingest/` and gate it with `assertIngestAuth`
3. Add the schedule to `[triggers] crons` in `wrangler.toml` and map it to the route in `worker/cron-routes.ts`
4. Write validation logic (transform → `items.inbox_items`, with an idempotency key)
5. Add knowledge graph linking
6. Add the credentials as Worker secrets with `npx wrangler secret put <NAME> --name brick-intel`, never to the repo
7. Deploy and test with a dry run before letting it write

## Related Documentation

- **Architecture:** System topology, auth model, source registry
- **Getting Started:** Setup, Logins, Install Tools
- **Command:** Portfolio management (Intel feeds into Command inbox)
- [Data Ingestion](/docs/data-ingestion)
- [Neon Database](/docs/neon-database)
- [Cloudflare Access](/docs/access-auth)
