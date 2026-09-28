# Architecture Overview

Complete system architecture for the LFIQ platform, including the BRICK family of applications, data topology, deployment infrastructure, and auth model.

## The BRICK Family (9 Applications)

| App | Purpose | Tech | Users |
|-----|---------|------|-------|
| **Hub** | Entry point, document index, Brick chat interface | Next.js 16, React 19, Cloudflare Worker `brick-hub` | Everyone |
| **Intel** | Data convergence, observation inbox, property insights | Next.js 16 on vinext, Cloudflare Worker `brick-intel` with cron triggers, Neon | Analysts, Operators |
| **Command** | Portfolio management, properties, leasing, maintenance, collections, risk | Next.js 16 monorepo, one Cloudflare Worker per sub-app (`brick-command`, `brick-collect`, `brick-repair` and others), Neon, Fly backend | Operators, Asset Managers |
| **Keystone** | Personal knowledge management, daily briefing, automation | Next.js 16 on vinext, Cloudflare Worker `brick-keystone`, Python automation, Neon | Everyone (personal) |
| **Registry** | Deal tracking, opportunities, activities, CRM | Next.js 16, Cloudflare Worker `brick-registry`, Neon | Deal team |
| **Stacks** | SF sourcing pipeline, property dossier, PropertyRadar integration | Next.js 16 on vinext, React 19, Cloudflare Worker `brick-stacks`, Neon | Acquisitions |
| **Sticks** | Personal AI assistant | Next.js 16, Cloudflare Worker `brick-sticks` | Everyone |
| **Watch** | SF parcel watch: notifies on new DBI complaints and notices of violation for watched parcels | Next.js 15, Cloudflare Worker `brick-watch`, Neon `civic` schema | Whoever the Access policy admits |
| **leftfieldiq.com** | Product marketing, investor materials, public website | Next.js 15 on vinext, Cloudflare Worker `lfiq-website` | Public |

## One Database Architecture

All LFIQ applications share a **single Neon database** (PostgreSQL). Data is organized by schema, not by separate databases.

**Neon Project Details:**
- **Endpoint:** `ep-hidden-union-aromj80p` (Neon project `lfiq-command`, `nameless-paper-46385107`)
- **Database:** neondb
- **Region:** us-west-2
- **Backup:** Neon Autoscaling + daily snapshots

**10 Schemas:**

| Schema | Purpose | Owned By |
|--------|---------|----------|
| `portfolio` | Properties, units, rents, leases, valuations | Command |
| `items` | Observations, inbox, tasks, knowledge graph | Intel |
| `gdm` | Power BI Golden Data Model extract (Power BI import) | gdm_extractor |
| `market` | Leasing comps, competitor data, rent trends | market_scraper |
| `registry` | Deals, opportunities, activities, contacts | Registry |
| `stacks` | SF sourcing pipeline, dossier, PropertyRadar data | Stacks |
| `collect` | Collections, delinquency, resident interactions | Command/Collections |
| `repair` | Work orders, technicians, maintenance costs | Command/Repair |
| `public` | PKM (daily briefing, tasks, automation state) | Keystone |
| `semantic` | Vector embeddings for search and discovery | Intel (Pinecone sync) |

**Per-App Database Roles (least privilege):**
- `intel`: SELECT/INSERT on items, market (ingest); SELECT on portfolio, gdm
- `command`: SELECT/INSERT/UPDATE on portfolio, collect, repair; SELECT on items, market
- `pkm`: SELECT/INSERT/UPDATE on public
- `gdm_extractor`: SELECT/INSERT/UPDATE on gdm
- `market_scraper`: SELECT/INSERT/UPDATE on market
- `neondb_owner`: DDL migrations only

## Deployment Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSER / CLIENT                               │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTPS
┌─────────────────────────────▼────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS                                     │
│  Workers: Hub, Intel, Command + sub-apps, Keystone, Registry, Stacks,   │
│           Sticks, Watch; brick-cron-http (service-job dispatcher)       │
│  Auth: Cloudflare Access in front of every internal hostname            │
└────┬───────────────┬──────────────┬──────────────┬──────────────────────┘
     │               │              │              │
     │ Next.js Apps  │ API Routes   │ Static Assets│
     │ (SSR/SSG)     │ (Serverless) │ (cached)     │
     │               │              │              │
┌────▼───────────────▼──────────────▼──────────────▼──────────────────────┐
│              COMPUTE LAYER                                               │
│  ┌──────────────────────┐    ┌──────────────────────┐                   │
│  │   Fly.io             │    │   Fly.io             │                   │
│  │   brickston-backend  │    │   brick-cron         │                   │
│  │   (Neon access,      │    │   (supercronic;      │                   │
│  │    Command API,      │    │    gdm-extractor,    │                   │
│  │    GraphQL)          │    │    pbi-sync,         │                   │
│  │   brick-mcp-server   │    │    valuation jobs,   │                   │
│  │   pkm-mcp            │    │    briefing jobs)    │                   │
│  └──────────────────────┘    └──────────────────────┘                   │
└───────────────┬──────────────────────┬─────────────────────────────────┘
                │                      │
                │ Neon Protocol        │ SQL
                │                      │
┌───────────────▼──────────────────────▼─────────────────────────────────┐
│              NEON DATABASE (POSTGRES)                                   │
│              endpoint ep-hidden-union-aromj80p                        │
│              ┌─────────────────────────────────────────────────────┐  │
│              │  neondb (10 schemas)                                 │  │
│              │  - portfolio    - items       - gdm                  │  │
│              │  - market       - registry    - stacks               │  │
│              │  - collect      - repair      - public               │  │
│              │  - semantic (embeddings)                             │  │
│              └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│         EXTERNAL DATA SOURCES (27 registered, 24 live)                 │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ Microsoft 365        │  │ Granola              │                  │
│  │ - Outlook calendar   │  │ - Meeting transcripts│                  │
│  │ - SharePoint reports │  │                      │                  │
│  │ - Teams              │  │                      │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ Smartsheet           │  │ PropertyRadar        │                  │
│  │ - Task tracking      │  │ - SF property data   │                  │
│  │ - Projects           │  │ - Distress scores    │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ DataTree             │  │ SF Open Data         │                  │
│  │ - Property records   │  │ - SF Assessor (APN)  │                  │
│  │ - Liens              │  │ - SF Rent Board      │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ Power BI / Reports   │  │ Pinecone (Vector DB) │                  │
│  │ - Costumer Golden DM │  │ - Embeddings for RAG │                  │
│  │ - Daily exports      │  │                      │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ Zoom                 │  │ Anthropic API        │                  │
│  │ - Meeting transcripts│  │ - Claude models      │                  │
│  │ - Recording metadata │  │ - Chat, embeddings   │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
│                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                  │
│  │ Cartesia             │  │ Cloudflare           │                  │
│  │ - AI voice synthesis │  │ - Email workers      │                  │
│  │                      │  │ - DNS / CDN          │                  │
│  └──────────────────────┘  └──────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
```

## Authentication Model

Every internal app is fronted by Cloudflare Access. Clerk was retired on 2026-09-17, and NextAuth is no longer a dependency of any app. Access authenticates the caller before the request reaches the Worker and forwards the verified address in the `Cf-Access-Authenticated-User-Email` header, stripping any client-supplied copy. Authorization is a row in `items.auth_allowed_users`: its `apps` array and `is_admin` flag drive the per-app checks.

| App | Provider | Gating | Notes |
|-----|----------|--------|-------|
| **Hub** | Cloudflare Access | Access identity in middleware, `items.auth_allowed_users` row in server code | Middleware runs at the edge and cannot reach Postgres, so the table lookup happens in server code |
| **Intel** | Cloudflare Access | Access JWT verified against `CF_ACCESS_AUD` | Two Access applications: one for people, one for machine callers scoped to `/api/ingest` |
| **Command** | Cloudflare Access | Access identity per sub-app Worker | Each sub-app is its own Worker and hostname |
| **Keystone** | Cloudflare Access | Access identity in middleware | MCP server uses its own bearer token, separate from the web session |
| **Registry** | Cloudflare Access | Access identity in middleware | |
| **Stacks** | Cloudflare Access | Access JWT verified against `CF_ACCESS_AUD` | `apps` must include `stacks` or the user is refused |
| **Sticks** | Cloudflare Access | Access identity in middleware | |
| **leftfieldiq.com** | None | Public | Open to internet |

**Sign-in model:** Access is the only perimeter. A new engineer needs an Access policy that admits them and a row in `items.auth_allowed_users` before any app will let them in. See [Cloudflare Access](/docs/access-auth) for the auth detail page.

## External Data Sources

Intel's source registry (`brick.intel/app/lib/sources.ts`) declares **27 sources: 24 live and 3 down**. The three down sources are Yardi, DocuSign, and a retired local file-drop feed. The full per-source table lives on [Data Ingestion](/docs/data-ingestion).

### Synchronous APIs (on-demand)
- **Anthropic API**: Claude chat, embeddings for Brick chat
- **Cartesia**: Voice synthesis for alert notifications
- **Cloudflare Email Workers**: Inbound deal and report forwarding

### Scheduled Ingest Pipelines (Cloudflare cron triggers and Fly `brick-cron`)
1. **Microsoft 365, both tenants** (every 4h, `brick-intel` cron trigger): Email, calendar, contacts
2. **SharePoint report imports** (every 2h, `brick-intel` cron trigger): Yardi report workbooks
3. **Granola** (every 6h, `brick-intel` cron trigger): Meeting transcripts
4. **Zoom** (every 6h, `brick-intel` cron trigger): Meeting transcripts
5. **Smartsheet** (08:00 UTC daily, `brick-intel` cron trigger): Task tracking, project data
6. **Connected file sources** (every 6h, `brick-intel` cron trigger): Box, Dropbox, Google Drive
7. **Market news and listing alerts** (every 6h, `brick-intel` cron trigger): RSS and inbox-routed alerts
8. **SF Open Data** (06:00 PT daily, `brick-cron-http` Worker): Assessor parcel records, permits, civic data
9. **Craigslist SF rentals** (01:00 and 13:00 PT, Fly `leasing-cl-scrape`): Competitor listing scrape
10. **Power BI** (18:30 UTC daily, Fly `gdm-extractor`): Golden Data Model export to the `gdm` schema
11. **Brickston portfolio scans** (daily, `brick-cron-http` Worker): AR events, notice-to-vacate, vendor COI expiry, permits, code violations
12. **Pinecone** (on write): Vector sync for RAG and semantic search

Manual report delivery is by email to a dedicated inbound address, handled by a Cloudflare Email Worker. OneDrive was retired as a report transport in July 2026, even though the Intel source key is still literally `onedrive-report-imports`.

## Key Infrastructure Facts

Summary only. The detail pages are [Neon Database](/docs/neon-database), [Cloudflare Deployment](/docs/cloudflare-deployment), and [Fly.io Backend](/docs/fly-io-backend).

### Database Connections
- **Neon Serverless Driver** (postgres-js): Cloudflare Workers and Fly
- **Pooled vs direct**: apps run on the pooled `DATABASE_URL`; `DATABASE_URL_UNPOOLED` is for migration tooling only
- **Connection string format:** `postgresql://user:password@host/dbname?sslmode=require`
- **No local database proxy**: nothing listens on port 5433. Connect straight to Neon.

### Secrets Management
- **Neon roles**: per-app, password-based
- **Worker secrets**: per Worker, set with `wrangler secret put`. For local dev, copy the repo's `.dev.vars.example` to `.dev.vars` and fill it from Neon and the operator Keychain
- **Fly app secrets**: `flyctl secrets` for `brickston-backend`, `brick-cron`, and the MCP apps
- **macOS Keychain**: local operator credentials such as the Fly deploy token
- **Local .env.local**: development only, git-ignored

Secret **names** are safe to write down. Values never go in a repo.

### Observability
- **Cloudflare Workers observability**: enabled in each Worker's wrangler config; stream live logs with `wrangler tail <worker>` or read them in the Cloudflare dashboard
- **Fly.io logs**: `brickston-backend` and `brick-cron` job output
- **Neon console**: slow queries via `pg_stat_statements`
- **Browser DevTools**: client-side errors, network traces

### Build & Deployment Pipeline
- **Git**: Single source of truth (GitHub, LFIQ-Git org)
- **Cloudflare Workers Builds**: automatic deploy on push to `main`
- **Fly.io**: Manual `flyctl deploy` after git push; builds run locally, so a Docker daemon has to be up
- **CI Gates**: GitHub Actions: linting, type-checking, test suite before merge

### Local scheduled jobs are retired
All `com.justinsato.*` launchd jobs on the operator Mac were unloaded and removed on 2026-06-23. `launchctl list` shows none of them. Scheduled work now runs in Cloudflare Worker cron triggers, on Fly `brick-cron`, or through the MCP scheduled-tasks scheduler. Do not add a launchd job to fix a stale feed.

## Data Flow: One Observation to Dashboard

Example: New Smartsheet task → Intel observation → Command inbox item → dashboard alert

1. **Smartsheet nightly sync** (`brick-intel` cron trigger, `/api/ingest/smartsheet`, 08:00 UTC)
   - Fetches new tasks from Smartsheet API
   - Inserts into `items.inbox_items` with `source='smartsheet'`

2. **Intel extractor and edge builder** (`brick-intel` cron triggers)
   - `/api/extract` polls inbox_items for new observations every 15 minutes
   - `/api/cron/extract-edges` enriches with knowledge graph edges hourly
   - `/api/admin/push-observations` bridges observations to Command every 30 minutes

3. **Command refresh** (Command API + TanStack Query)
   - Command inbox subscription updates
   - Displays observation in `/inbox`
   - User acknowledges or creates task

4. **Keystone briefing** (next morning)
   - Daily briefing queries items for user email
   - Renders markdown summary in `public.daily_briefing`

This flow ensures data fidelity, traceability, and single-source-of-truth through the Neon database.
