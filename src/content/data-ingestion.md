# Data Ingestion Workflow

Everything the platform knows about the portfolio and the SF market arrives through one of four transports: a scheduled pull, an inbound email, a push from another app in the fleet, or a manual run. This page is the map of what feeds what, on what cadence, and how to tell when a feed has quietly stopped.

## The two ingestion planes

| Plane | What it does | Lands in | Registry of record |
|-------|--------------|----------|--------------------|
| **Sources** | Bring raw external data into the platform | `items.inbox_items` (Intel), `gdm.*`, `portfolio.*`, `market.*`, `stacks.*` | `brick.intel/app/lib/sources.ts` seeds `items.source_config` |
| **Workflows** | Transform data already in-system | `items.tasks`, `items.commitments`, `items.decisions`, `items.knowledge_edges` | `items.workflow_runs` |

Do not confuse the two. `/api/extract`, `/api/cron/extract-edges`, and `/api/admin/push-observations` in Intel are workflows, not sources. If a source card looks dead but rows are arriving, the problem is usually the extractor, not the pull.

## Source count

The Intel source registry (`app/lib/sources.ts`) declares **27 sources**: 24 marked `live` and 3 marked `down` (`yardi`, `docusign`, `cloud-storage`). The file's own header comment still says "the canonical 14 sources" and the docs sidebar still reads "Data Ingestion (14 sources)". Both labels are stale. Treat the array in `sources.ts` as the count, and remember that the Intel registry does not cover the pipelines that bypass `inbox_items` entirely (Power BI, the leasing market scrape, and the Stacks SF civic pull).

## Intel-native sources (Vercel cron on `intel.lfiq.app`)

Schedules below are the live entries in `brick.intel/vercel.json`. All Vercel cron expressions are UTC.

| Route | Cron | Sources produced | Notes |
|-------|------|------------------|-------|
| `/api/cron/graph-pull` | `0 */4 * * *` | `m365-lfi`, `m365-mosser`, `teams-chat`, `outlook-contacts`, `market-listings` | Microsoft Graph. LFI tenant is app-only; Mosser is a delegated refresh token |
| `/api/ingest/granola` | `0 */6 * * *` | `granola` | Intel polls the Granola API, read-only |
| `/api/ingest/zoom` | `45 */6 * * *` | `zoom` | Meeting records, 6h lag parameter |
| `/api/ingest/smartsheet` | `0 8 * * *` | `smartsheet` | Fixed artifact set, content-hashed idempotency |
| `/api/ingest/market-news` | `10 */6 * * *` | `market-news` | RSS feeds |
| `/api/ingest/market-listings` | `20 */6 * * *` | `market-listings` | Subject-line sweep, complements graph-pull routing |
| `/api/cron/connections-pull` | `40 */6 * * *` | `google-gmail`, `google-calendar`, `google-drive`, `dropbox`, `box` | OAuth broker connections |
| `/api/cron/graph-report-imports` | `15 */2 * * *` | `onedrive-report-imports` | Operating reports, see below |

The source registry's `cadence` strings drift from `vercel.json` (several still say "every 2h" where the cron is every 4h). `vercel.json` wins.

## Operating report imports

This is the pipeline that carries the rent roll, vacancy, general ledger, AP detail, tenant memos, and the financial workbooks. Two transports feed one dispatcher.

| Transport | Mechanism | Live for |
|-----------|-----------|----------|
| SharePoint reporting site | Intel cron scans pinned folders, matches on **exact filename**, downloads on eTag change | Vacancy Report, IMG Rent Roll, the three financial workbooks |
| Email | Send the workbook to `reports@in.lfiq.app`; a Cloudflare Email Worker relays it to Intel | Tenant Memos, AP Expense Detail, General Ledger |

Registry of record is `brick.intel/app/lib/graph-report-imports.ts`. Command's Reports Console reads the same registry over `GET /api/report-registry`, so a report added there appears in both places.

Facts that matter operationally:

- **OneDrive is retired as a transport.** The source key is still literally `onedrive-report-imports`, which is a naming leftover. Nothing is sourced from a personal OneDrive folder. Do not propose a folder drop for a manual report.
- Automated Yardi reports arrive from the Yardi scheduler with the subject "Scheduler Reports" and a generic attachment name, so identity is matched on **body keywords**, not filename. The keyword map lives in the registry.
- Attachments are relayed through object storage rather than posted inline, because Intel runs as a Vercel function with a request body cap. Large workbooks would otherwise fail with a 413.
- Cloudflare Email Routing enforces its own message size cap upstream of the worker. A file large enough to be rejected there leaves no trace at all in the platform. If a report never appears and the worker shows no invocation, suspect the mail gate before the importer.
- Each report carries a `maxAgeHours` budget in the registry. Staleness is measured from the **last successful import**, not folder modification time, because the email path never touches a watched folder.

## Fleet batch jobs (Fly `brick-cron`)

Batch jobs run on fly.io, org `brickston`. The dispatcher is a small always-on machine running `supercronic` against `/app/crontab`; each line launches a one-off machine on the live backend image and destroys it when the job exits. Container timezone is **America/Los_Angeles**, so these are Pacific, not UTC.

| Label | Cron (PT) | What it does |
|-------|-----------|--------------|
| `valuation-extractor` | `*/5 * * * *` | Drains the valuation drop; no-op when empty |
| `valuation-sourcer` | `0 6 * * *` | Feeds the valuation drop |
| `pbi-sync` | `0 4 * * *` | Power BI sync into `portfolio.pbi_*` |
| `insight-tagger` | `*/15 * * * *` | Resolves property/vendor/lender FKs on `items.inbox_items` |
| `gdm-extractor` | `30 11 * * *` | Golden Data Model extract into `gdm.*` (own app image) |
| `gdm-extractor-financials` | `0 5 1,15 * *` | Financials extract on the 1st and 15th |
| `mobuk-sync` | `30 19 * * 1` | Weekly sync |
| `briefing-daily-audio` | `0 7 * * *` | See the Daily Briefing page |
| `briefing-daily-public` | `15 7 * * *` | See the Daily Briefing page |
| `briefing-weekly-soap` | `0 8 * * 1` | See the Daily Briefing page |

The canonical crontab is checked in at `brick.hub/docs/migration-artifacts/fly/fly-cron/crontab`. Nothing about `brick-cron` lives in the Command repo.

**GCP is wound down.** Billing is disabled on the `brickston-v2` project, so the Cloud Scheduler API refuses every call including a plain list. Any doc or code comment describing these jobs as Cloud Run or Cloud Scheduler is out of date. One job, `migration-runner-job`, is still parked on GCP and idle.

## Command-produced sources

Command's own scan jobs read the portfolio schema and POST digests to Intel `/api/ingest/market` with a shared ingest secret, differentiated by the `source` field. The catalog is `brick.command/backend/app/jobs/registry.py`, which is the trigger source of truth and now carries a `platform` field per job.

| Intel source | Command endpoint | Cron (PT) |
|--------------|------------------|-----------|
| `brickston-ar` | `/api/v1/brickston-sync/ar-aging-events` | `30 4 * * *` |
| `brickston-ntv` | `/api/v1/brickston-sync/notice-to-vacate-events` | `40 4 * * *` |
| `brickston-vendor-coi` | `/api/v1/brickston-sync/vendor-coi-expiring-events` | `50 4 * * *` |
| `sf-open-data` | `/api/v1/brickston-sync/sf-open-data` | `0 6 * * *` |
| `craigslist` | `/api/v1/brickston-sync/market-summary` | `30 6 * * *` |
| `brickston-permits` | `/api/v1/brickston-sync/permit-near-property-events` | `0 7 * * *` |
| `brickston-code-violations` | `/api/v1/brickston-sync/code-violation-cure-events` | `10 7 * * *` |

These are `target_kind="service"` jobs, meaning an HTTP POST to the backend rather than a machine launch. They fire daily and are recorded in `portfolio.scheduled_job_runs`, but the trigger that calls them was never confirmed on Fly. Verify the caller before assuming a schedule change will take effect.

## Sources that bypass Intel

| Pipeline | Trigger | Writes | Owner repo |
|----------|---------|--------|------------|
| Power BI Golden Data Model | Fly `gdm-extractor` | `gdm.*` directly, truncate and reload | `brick.intel/jobs/gdm-extractor` |
| Leasing market scrape | GitHub Actions cron | `market.cl_ads`, `market.listings_current` | leasing scraper repos |
| SF civic and parcel data | Vercel cron on Stacks, `0 8 * * *` UTC | `stacks.parcels`, `stacks.signals` | `brick.stacks` |

The Golden Data Model is the exception to the "everything lands in `inbox_items`" rule, and it is the only Power BI import in the fleet.

## Stacks external data sources

Nightly ingest runs only the free adapters. Paid pulls are gated and never fire on a schedule.

| Adapter key | Cost | Contributes |
|-------------|------|-------------|
| `datasf-assessor` | Free | Parcel universe seed, 5+ unit filter |
| `datasf-permits` | Free | Deferred capex and activity signal |
| `datasf-evictions` | Free | Turnover and distress, including Ellis Act |
| `datasf-code` | Free | DBI code-enforcement complaints |
| `datasf-violations` | Free | Escalated DBI notices of violation |
| `datasf-fire` | Free | Fire incidents |
| `datasf-energy` | Free | Energy ordinance compliance |
| `datasf-softstory` | Free | Mandatory seismic retrofit status |
| `datasf-tax` | Free | Documented no-op, no free SF bulk feed |
| `recorder-nod` | Free | Documented no-op, no free bulk feed |
| `propertyradar` | Paid | Mortgage records, pre-foreclosure, distress score |
| `propertyradar-monitor` | Paid | Membership diff, cheaper than a fresh export |
| `datatree` | Paid | Farm search per distress dimension |

The split is enforced in code. `freeAdapters()` in `lib/sources/index.ts` filters the paid keys out, and `/api/cron/ingest` calls that function rather than `allAdapters()`.

## Verifying a source is alive

Start with the source health surface at `intel.lfiq.app/sources`, then confirm in SQL. The Neon console defaults to the `public` schema; switch to `items` or the tables will look empty.

```sql
-- Row volume and freshness by source, last 7 days
SELECT source,
       count(*)                    AS rows_7d,
       max(received_at)            AS last_row,
       count(*) FILTER (WHERE processed_at IS NULL) AS unprocessed
FROM items.inbox_items
WHERE received_at > now() - interval '7 days'
GROUP BY source
ORDER BY last_row DESC;

-- Run telemetry for one source
SELECT started_at, completed_at, records_ingested, error
FROM items.source_runs
WHERE source = 'smartsheet'
ORDER BY started_at DESC
LIMIT 10;

-- Declared config vs. reality
SELECT source, status, enabled, trigger_env, cadence,
       alert_threshold_hours, next_expected_run
FROM items.source_config
ORDER BY sort_order;
```

Health is classified in `app/lib/source-display.ts` against the source's `alert_threshold_hours`:

| Label | Condition |
|-------|-----------|
| `healthy` | Last successful run inside the threshold |
| `stale` | Last success older than the threshold |
| `stale · critical` | Last success older than twice the threshold |
| `receiving` | Run telemetry is cold but rows are still arriving inside the threshold |
| `live · no run yet` | Registered and enabled, never recorded a run |
| `off` / `designed` | Declared `down` or not built; no SLA, sorts to the bottom |

The `receiving` state matters. A source can have broken run logging while ingestion works fine, which is exactly what happened to Smartsheet. Check `inbox_items` before declaring an outage.

## When a source fails

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Source card red, no rows at all | Cron did not fire, or credentials expired | Hit the route manually with the ingest secret and read the response |
| Rows arriving, extractor output missing | Extractor backlog, not an ingest problem | Query `processed_at IS NULL` counts, then run `/api/extract` |
| Report missing, no worker invocation | Message rejected at the mail gate upstream | Reduce the file size or route that report through the SharePoint feed |
| Report imported but rows unmatched | Property identity mismatch | See the Property Onboarding page |
| Graph pull 401s | Mosser delegated refresh token expired (roughly 90 days, rotates on use) | Re-mint the token from the capture script in Intel |
| Job ran, wrote nothing | Neon cold start timed out the connection | Warm with `SELECT 1`, rerun |

Manual runs. Every Intel ingest route accepts `x-ingest-secret`, `Bearer CRON_SECRET`, or `?secret=`. Never paste the value into a shared channel.

```bash
# Dry-run the report importer: shows found and changed files, writes nothing
curl -s "https://intel.lfiq.app/api/cron/graph-report-imports?dryrun=1&secret=$INGEST_SECRET" | jq .

# Force one source pull
curl -s -X POST "https://intel.lfiq.app/api/ingest/smartsheet" \
  -H "x-ingest-secret: $INGEST_SECRET" | jq .

# Re-run a Fly batch job by crontab label
flyctl ssh console -a brick-cron -C "/app/run-job.sh pbi-sync python -m jobs.pbi_sync_job"

# Stacks nightly ingest, free adapters only
curl -s "https://stacks.lfiq.app/api/cron/ingest" -H "X-Cron-Secret: $STACKS_CRON_SECRET" | jq .
```

Secret names only. Values live in Vercel environment settings, Fly app secrets, and the macOS Keychain. Nothing goes in a repo.

## Known gaps

| Gap | Status |
|-----|--------|
| Yardi / Voyager | No API access from our side. Every Yardi number reaches the platform through a scheduled report export, not a connection. Source is declared `down` |
| DocuSign | Declared `down`, no trigger configured |
| Cloud storage login-item | Driver was a retired local job; declared `down`, not being pursued |
| Command civic pipeline vs. Stacks | Two SF Open Data pullers still coexist. Consolidation onto Stacks is planned but not complete |

## Related pages

- [Intel](/docs/apps/intel)
- [Command](/docs/apps/command)
- [Stacks](/docs/apps/stacks)
- [Architecture Overview](/docs/architecture)
- [Property Onboarding](/docs/property-onboarding)
- [Daily Briefing Generation](/docs/daily-briefing)
- [Neon Database](/docs/neon-database)
