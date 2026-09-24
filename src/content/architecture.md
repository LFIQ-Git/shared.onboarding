# Architecture Overview

Complete system architecture for the LFIQ platform, including the BRICK family of applications, data topology, deployment infrastructure, and auth model.

## The BRICK Family (8 Applications)

| App | Purpose | Tech | Users |
|-----|---------|------|-------|
| **Hub** | Entry point, document index, Brick chat interface | Next.js 15, React 19, Clerk, Vercel | Everyone |
| **Intel** | Data convergence, observation inbox, property insights | Next.js 15, Clerk, Neon, Vercel crons | Analysts, Operators |
| **Command** | Portfolio management, properties, leasing, maintenance, collections, risk | Next.js 15 monorepo, Clerk, Neon, Fly backend | Operators, Asset Managers |
| **Keystone** | Personal knowledge management, daily briefing, automation | Next.js 15, Clerk, Python automation, Neon | Everyone (personal) |
| **Registry** | Deal tracking, opportunities, activities, CRM | Next.js 15, Clerk, Neon | Deal team |
| **Stacks** | SF sourcing pipeline, property dossier, PropertyRadar integration | Next.js 15, React 19, Clerk, Neon | Acquisitions |
| **Sticks** | Personal AI assistant | Next.js 15, NextAuth (Google), Vercel | Everyone |
| **leftfieldiq.com** | Product marketing, investor materials, public website | Next.js 15, MDX | Public |

## One Database Architecture

All LFIQ applications share a **single Neon database** (PostgreSQL). Data is organized by schema, not by separate databases.

**Neon Project Details:**
- **Endpoint:** ep-tiny-lab-akrddwgy.us-west-2.neon.tech
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
│                       VERCEL (Edge CDN)                                   │
│  Projects: Hub, Intel, Command, Keystone, Registry, Stacks, Sticks      │
│  Auth: Clerk OAuth redirect (Sticks: NextAuth + Google)                 │
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
│              ep-tiny-lab-akrddwgy.us-west-2.neon.tech                 │
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

The BRICK apps run on one shared Clerk instance. NextAuth and the old `@brick/auth` package were retired across those apps in the June 2026 migration. Sticks is the one exception and still runs its own NextAuth setup. Full detail is on [Clerk Authentication](/docs/clerk-auth).

| App | Provider | Gating | Notes |
|-----|----------|--------|-------|
| **Hub** | Clerk | `sessionClaims.apps` in middleware | Public splash, login required for features |
| **Intel** | Clerk | `sessionClaims.apps` + in-route checks | `/api/*` public in middleware, enforced per route |
| **Command** | Clerk | `createBrickClerkGate(appKey)` per sub-app | App key must match the Clerk session claim |
| **Keystone** | Clerk | `sessionClaims.apps` in middleware | MCP server uses its own bearer token, separate from the web session |
| **Registry** | Clerk | `sessionClaims.apps` in middleware | Empty claim metadata means all apps allowed |
| **Stacks** | Clerk | `sessionClaims.apps` in middleware | Production requires a `pk_live_` publishable key |
| **Sticks** | NextAuth v5 | Email allowlist in the sign-in callback | Google provider only, not on the shared Clerk instance |
| **leftfieldiq.com** | None | Public | Open to internet |

**Sign-in model:** For the Clerk apps, sign-in is social only, Google plus Microsoft. Passwords, passkeys and email codes are disabled. Sign-up is restricted to an allowlist of company domains, so a new engineer has to be invited before they can sign in anywhere. Log in once and the session carries across every Clerk app. Clerk org role decides which apps you see. See [Clerk Authentication](/docs/clerk-auth) for the role map and the middleware pitfalls.

## External Data Sources

Intel's source registry (`brick.intel/app/lib/sources.ts`) declares **27 sources: 24 live and 3 down**. The three down sources are Yardi, DocuSign, and a retired local file-drop feed. The full per-source table lives on [Data Ingestion](/docs/data-ingestion).

### Synchronous APIs (on-demand)
- **Google and Microsoft OAuth**: Clerk social login
- **Anthropic API**: Claude chat, embeddings for Brick chat
- **Cartesia**: Voice synthesis for alert notifications
- **Cloudflare Email Workers**: Inbound deal and report forwarding

### Scheduled Ingest Pipelines (Vercel crons and Fly `brick-cron`)
1. **Microsoft 365, both tenants** (every 2h, Vercel cron): Email, calendar, contacts
2. **SharePoint report imports** (every 2h, Vercel cron): Yardi report workbooks
3. **Granola** (every 6h, Vercel cron): Meeting transcripts
4. **Zoom** (every 6h, Vercel cron): Meeting transcripts
5. **Smartsheet** (08:00 UTC daily, Vercel cron): Task tracking, project data
6. **Connected file sources** (every 6h, Vercel cron): Box, Dropbox, Google Drive
7. **Market news and listing alerts** (every 6h, Vercel cron): RSS and inbox-routed alerts
8. **SF Open Data** (6:30 AM daily): Assessor parcel records, permits, civic data
9. **Craigslist SF rentals** (5:30 AM daily): Competitor listing scrape
10. **Power BI** (18:30 UTC daily, Fly `gdm-extractor`): Golden Data Model export to the `gdm` schema
11. **Brickston portfolio scans** (daily): AR events, notice-to-vacate, vendor COI expiry, permits, code violations
12. **Pinecone** (on write): Vector sync for RAG and semantic search

Manual report delivery is by email to a dedicated inbound address, handled by a Cloudflare Email Worker. OneDrive was retired as a report transport in July 2026, even though the Intel source key is still literally `onedrive-report-imports`.

## Key Infrastructure Facts

Summary only. The detail pages are [Neon Database](/docs/neon-database), [Vercel Deployment](/docs/vercel-deployment), [Fly.io Backend](/docs/fly-io-backend), and [GCP Cloud Run](/docs/gcp-cloud-run).

### Database Connections
- **Neon Serverless Driver** (postgres-js): Vercel and Fly
- **Pooled vs direct**: apps run on the pooled `DATABASE_URL`; `DATABASE_URL_UNPOOLED` is for migration tooling only
- **Connection string format:** `postgresql://user:password@host/dbname?sslmode=require`
- **No local database proxy**: Cloud SQL was deleted, so there is nothing to proxy on port 5433. Connect straight to Neon.

### Secrets Management
- **Neon roles**: per-app, password-based
- **Vercel Environment**: per-project, per-environment, pulled with `vercel env pull`
- **Fly app secrets**: `flyctl secrets` for `brickston-backend`, `brick-cron`, and the MCP apps
- **macOS Keychain**: local operator credentials such as the Fly deploy token
- **Local .env.local**: development only, git-ignored

Secret **names** are safe to write down. Values never go in a repo.

### Observability
- **Vercel Analytics and logs**: web performance, function logs, deployment metrics
- **Fly.io logs**: `brickston-backend` and `brick-cron` job output
- **Neon console**: slow queries via `pg_stat_statements`
- **Browser DevTools**: client-side errors, network traces

### Build & Deployment Pipeline
- **Git**: Single source of truth (GitHub, LFIQ-Git org)
- **Vercel**: Automatic deployments on push to main; preview deploys on PRs
- **Fly.io**: Manual `flyctl deploy` after git push; builds run locally, so a Docker daemon has to be up
- **CI Gates**: GitHub Actions: linting, type-checking, test suite before merge

### GCP is wound down
GCP is a wind-down, not a peer runtime to Fly. Billing is disabled on the `brickston-v2` project, so the Cloud Scheduler API refuses every call including a plain list. Batch jobs moved to Fly `brick-cron` running supercronic, and `brick-mcp-server` moved from Cloud Run to Fly on 2026-08-06. It is not fully gone: `migration-runner-job` is parked and idle, and two Vertex AI workloads remain. Treat any doc, comment, or command that presents Cloud Run or Cloud Scheduler as a live scheduling surface as out of date. See [GCP Cloud Run](/docs/gcp-cloud-run) and [Fly.io Backend](/docs/fly-io-backend).

### Local scheduled jobs are retired
All `com.justinsato.*` launchd jobs on the operator Mac were unloaded and removed on 2026-06-23. `launchctl list` shows none of them. Scheduled work now runs in Vercel crons, on Fly `brick-cron`, or through the MCP scheduled-tasks scheduler. Do not add a launchd job to fix a stale feed.

## Data Flow: One Observation to Dashboard

Example: New Smartsheet task → Intel observation → Command inbox item → dashboard alert

1. **Smartsheet nightly sync** (Vercel cron, `/api/ingest/smartsheet`, 08:00 UTC)
   - Fetches new tasks from Smartsheet API
   - Inserts into `items.inbox_items` with `source='smartsheet'`

2. **Intel extractor and edge builder** (Vercel crons)
   - `/api/extract` polls inbox_items for new observations every 15 minutes
   - `/api/cron/extract-edges` enriches with knowledge graph edges hourly
   - `/api/admin/push-observations` bridges observations to Command every 30 minutes

3. **Command refresh** (Vercel API + TanStack Query)
   - Command inbox subscription updates
   - Displays observation in `/inbox`
   - User acknowledges or creates task

4. **Keystone briefing** (next morning)
   - Daily briefing queries items for user email
   - Renders markdown summary in `public.daily_briefing`

This flow ensures data fidelity, traceability, and single-source-of-truth through the Neon database.
