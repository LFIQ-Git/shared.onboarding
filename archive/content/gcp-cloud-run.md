# GCP Cloud Run (Wind-Down)

Google Cloud used to run the LFIQ backend, the MCP servers, and every scheduled job. Almost none of that is true anymore. This page exists so you can recognize dead infrastructure in old documentation and know where each workload actually went.

Billing was disabled on the `brickston-v2` project on 2026-08-08. Do not write new code against Cloud Run.

## Current state in one table

| Layer | Status as of 2026-08-12 | Where it runs now |
|-------|-------------------------|-------------------|
| Web front ends | Never on Cloud Run since 2026-06-10 | Vercel |
| API backend | Cloud Run service idle since 2026-07-24 | Fly `brickston-backend` |
| MCP servers | Cloud Run services idle since 2026-07-24 and 2026-07-26 | Fly `brick-mcp-server`, Fly `pkm-mcp` |
| Scheduled batch jobs | Migrated or deleted between 2026-07-24 and 2026-08-08 | Fly `brick-cron` |
| Cloud Scheduler | API unreachable, billing disabled | Fly `brick-cron` (supercronic) |
| Secret Manager | Still readable and still in use | GCP `brickston-v2` |
| Vertex AI | Still in use, no migration planned | GCP `brickston-v2` |

## Projects

| Project | Purpose | Billing |
|---------|---------|---------|
| `brickston-v2` | BRICK fleet Cloud Run, secrets, scheduler, Vertex AI | Disabled 2026-08-08 |
| `graphic-iridium-485814-b2` | Personal and PKM workloads, region `us-west1` | Disabled, confirmed 2026-08-12 |

Both projects are billing-disabled. Verified on `graphic-iridium-485814-b2` by calling the Scheduler API, which refuses with `PERMISSION_DENIED ... BILLING_DISABLED`. Treat every Cloud Run job and Cloud Scheduler trigger in either project as unable to fire.

Disabling billing did not delete anything. It made the Cloud Scheduler API refuse every call, including a plain `jobs list`. The Cloud Run Admin API and Secret Manager both still respond.

## What was decommissioned and where it went

### Cloud Run services

| Service | Project | Fate | Replacement |
|---------|---------|------|-------------|
| `brickston-backend` | `brickston-v2` | Idle since cutover 2026-07-24, kept warm for rollback | Fly `brickston-backend` |
| `pkm-mcp` | `brickston-v2` | Idle since 2026-07-24 | Fly `pkm-mcp` at `keystone-mcp.lfiq.app` |
| `brick-mcp-server` | `graphic-iridium-485814-b2` | Idle since 2026-07-26; the old Cloud Run URL now returns 404 | Fly `brick-mcp-server` at `brick-mcp.lfiq.app` |
| `brickston-frontend` | `brickston-v2` | Deleted 2026-06-10, along with the load balancer, IAP stack, NEGs, URL maps, forwarding rules, and static IP | Vercel |
| `pkm-dashboard-api` | `graphic-iridium-485814-b2` | Deleted 2026-07-26; source no longer exists | Keystone on Vercel |
| `pkm-cleaner-engine` | `graphic-iridium-485814-b2` | Deleted 2026-07-26 | Keystone on Vercel |
| `fridgeart` | `graphic-iridium-485814-b2` | Deleted 2026-07-26, broken stub | none |
| `python-runner` | `brickston-v2` | Status not verified, confirm with Justin | unknown |

If you find a client still pointed at a Cloud Run `*.run.app` URL for the backend or either MCP server, that client is broken or will be. The DNS records for `brick-mcp.lfiq.app` were cut over to Fly anycast addresses on 2026-07-26.

### Cloud Run jobs

Nine batch jobs moved to the Fly `brick-cron` dispatcher. Two were deleted outright. One is parked.

| Job | Fate | Now |
|-----|------|-----|
| `gdm-extractor` | Moved 2026-08-08, Cloud Run job deleted | Fly `brick-cron`, label `gdm-extractor`, daily |
| `pbi-sync-job` | Moved | Fly `brick-cron`, label `pbi-sync`, daily |
| `insight-tagger-job` | Moved 2026-08-08, Cloud Run job deleted | Fly `brick-cron`, label `insight-tagger`, every 15 minutes |
| `valuation-extractor` | Moved | Fly `brick-cron`, every 5 minutes |
| `valuation-sourcer` | Moved | Fly `brick-cron`, daily |
| `mobuk-sync` | Moved | Fly `brick-cron`, weekly |
| `brick-briefing` (daily audio, weekly video) | Moved | Fly `brick-cron`, three labels |
| `sreo-import-job` | Moved, on demand only | Fly `brick-cron`, run manually |
| `items-hub-causal` | Killed by design 2026-08-08 | Nothing. Its image was removed from Artifact Registry on 2026-08-06 and every run after that failed. Folded into the task-system redesign |
| `migration-runner-job` | Parked on Cloud Run, idle since 2026-05-16 | Waiting on a schema freeze before it moves |
| `lfi-invoice-job` | Superseded, cannot fire. Billing is disabled on its project | Fly app `lfi-invoice`, migrated 2026-07-26 |

The `gdm-extractor` source still lives at `brick.intel/jobs/gdm-extractor/`, and its heartbeat rows in `items.source_runs` still record `trigger_env='cloud-run'` because that string was never updated after the move. The job runs on Fly. Ignore the label.

`lfi-invoice-job` looks like a duplicate of the Fly app `lfi-invoice` and is worth understanding, because both send real invoices rather than drafts. It was resolved on 2026-08-12: only the Fly app can run. Billing is disabled on `graphic-iridium-485814-b2`, so the Cloud Run job and its two Cloud Scheduler triggers cannot fire. The Fly machine `lfi-invoice-cron` runs daily and the job self-gates in code to the 1st and 15th, which is why a daily schedule is correct here.

The two copies are the same program. The Fly version drops the object-storage archive step and reads its Microsoft Graph refresh token from Neon rather than GCP Secret Manager. Do not reintroduce the GCP copy.

### Cloud Scheduler

Roughly 53 Cloud Scheduler jobs existed before the migration, about 39 in `brickston-v2` and 14 in `graphic-iridium-485814-b2`.

| Group | Recorded state |
|-------|----------------|
| Job triggers for the migrated batch jobs | Orphaned. The Cloud Run jobs behind them were deleted and the triggers cannot be deleted while billing is disabled |
| Around 31 HTTP triggers that POST into the backend | Paused during the 2026-07-24 cutover, not deleted, reversible |
| Around 14 personal triggers in `graphic-iridium-485814-b2` | Not inventoried |

There is an unresolved question here. Some records describe roughly 25 Tier-2 HTTP triggers still POSTing into the Fly-hosted backend, gated through Command's `/admin/jobs` page. That cannot be true while billing is disabled on `brickston-v2`, because Cloud Scheduler will not fire. Treat any workflow that depends on a Cloud Scheduler HTTP trigger as not verified, and confirm with Justin.

## What still genuinely runs on Google

Two things, and both are hard to move.

| Service | Used by | Why it stays |
|---------|---------|--------------|
| Vertex AI embeddings | Command backend, `app/ai/embeddings.py` | Loan and lease document embeddings. Moving providers means re-embedding the entire corpus |
| Vertex AI Search / Discovery Engine | Command backend, `app/ai/notebooklm.py`, drives the M20 draw preflight | No comparable API elsewhere for the notebook-style ingest and grounded Q&A |

Both are called from the Fly backend using a service account, `fly-vertex-query@brickston-v2`, whose credentials arrive as the `GCP_SA_JSON` secret on `brickston-backend`.

Secret Manager in `brickston-v2` is also still the source of truth for connection strings and API keys, including the Neon DSNs. It keeps working with billing disabled.

## Migration timeline

Dates matter here because most of the repository documentation predates the moves and reads as if Cloud Run is still live.

| Date | Event |
|------|-------|
| 2026-05-07 | Google deprecated the gcloud out-of-band OAuth flow |
| 2026-05-16 | Cloud SQL instance `brickston-v2:us-west1:brickston-db` stopped; Command's backend repointed at Neon |
| 2026-05-17/18 | Three Neon databases consolidated into one `neondb`, split by schema |
| 2026-06-10 | `brickston-frontend` Cloud Run service deleted along with the entire load balancer and IAP stack |
| 2026-07-23 | GCP to Fly migration plan drafted, phase 0 complete |
| 2026-07-24 | Backend cutover. `brickston-backend` and `pkm-mcp` live on Fly. First wave of batch jobs moved. Around 31 Cloud Scheduler HTTP triggers paused |
| 2026-07-25 | Object storage rewired from GCP to Cloudflare R2 and verified |
| 2026-07-26 | `brick-mcp.lfiq.app` DNS cut over to Fly. Three dead services deleted from `graphic-iridium-485814-b2` |
| 2026-08-06 | `items-hub-causal` image removed from Artifact Registry; every subsequent run failed |
| 2026-08-08 | Billing disabled on `brickston-v2`. `insight-tagger-job` and `items-hub-causal` deleted from Cloud Run. Fly `brick-cron` took over all migrated jobs |

## Reading stale documentation

You will hit these claims in repository files and old runbooks. Each one is wrong now.

| If a doc says | The current truth is |
|---------------|----------------------|
| "Deploy the backend with `gcloud run deploy`" | `flyctl deploy --app brickston-backend --local-only` from `brick.command/backend` |
| "The GDM extractor is a Cloud Run job in `brickston-v2`" | It runs from Fly `brick-cron` on the `brick-gdm` app, daily at 11:30 Pacific |
| "`items-hub-causal` runs nightly on Cloud Run" | Deleted 2026-08-08, not replaced |
| "Cloud SQL `brickston_v2` on port 5433 via the Auth Proxy" | Cloud SQL is gone. Connect to Neon `neondb` directly |
| "Four Cloud Run jobs still run against Neon" | Three moved to Fly. `migration-runner-job` is parked and idle |
| "brick-mcp-server is a private Cloud Run service behind OIDC" | It is a Fly app at `brick-mcp.lfiq.app` with bearer-token auth. The service-account and OIDC pattern still applies only to Vertex calls |
| "Cloud Scheduler fires the nightly jobs" | Supercronic on Fly `brick-cron` does. Cloud Scheduler cannot fire while billing is disabled |
| "Scheduled work runs on the Mac via launchd" | All local `com.justinsato.*` jobs were retired. Scheduled work is cloud-side |

## gcloud commands that still work

Authenticate first. The out-of-band flow was deprecated by Google on 2026-05-07 and now fails with `Error 400: invalid_request`:

```bash
# correct
gcloud auth login --launch-browser
gcloud auth application-default login --launch-browser
gcloud config set project brickston-v2
```

Both spin up a loopback listener on `localhost:8085`. Open the printed URL in a real browser on the Mac.

| Command | Works | Notes |
|---------|-------|-------|
| `gcloud secrets versions access latest --secret=<name> --project=brickston-v2` | Yes | The command you will actually use |
| `gcloud secrets versions add <name> --project=brickston-v2` | Yes | Rotating a secret |
| `gcloud run jobs list --project=brickston-v2` | Yes | Cloud Run Admin API is unaffected |
| `gcloud run jobs describe <job> --project=brickston-v2` | Yes | Useful for reading old job configs |
| `gcloud run jobs delete <job> --project=brickston-v2` | Yes | Cleanup |
| `gcloud scheduler jobs list --project=brickston-v2` | No | Billing disabled |
| `gcloud scheduler jobs describe <job> --project=brickston-v2` | No | Billing disabled |
| `gcloud scheduler jobs delete <job> --project=brickston-v2` | No | Billing disabled. This is why the orphaned triggers are still there |
| `gcloud run deploy ...` | No | Do not deploy to Cloud Run. Use `flyctl deploy` |

Pull a database URL:

```bash
gcloud secrets versions access latest \
  --secret=items-hub-database-url \
  --project=brickston-v2
```

## Logging and observability

Cloud Logging was the log store for every Cloud Run service and job. Nothing writes to it now except Vertex AI calls, and its behavior with billing disabled has not been tested. Assume it is read-only at best.

For anything you actually need to debug today:

| Looking for | Go to |
|-------------|-------|
| Backend request logs and tracebacks | `flyctl logs -a brickston-backend` |
| Batch job output | `flyctl logs -a brick-cron`, then the one-off machine's logs |
| Job success and failure alerts | The self-hosted Healthchecks instance on Fly, `brick-cron-monitor` |
| Front-end build and runtime logs | Vercel dashboard, or `vercel logs <domain> --scope lfiq` |
| Ingest and extraction health | Intel's source-health views in the `items` schema |

## What is still open

These are the items a new engineer will trip over, in the order they matter.

1. Re-enable billing on `brickston-v2` long enough to delete the orphaned Cloud Scheduler triggers, then decide whether the paused HTTP triggers are being replaced or restored.
2. Confirm whether `python-runner` still serves anything. If not, delete it.
3. Resolve the `lfi-invoice` duplication before an invoice goes out twice.
4. Delete the idle Cloud Run services once the Fly bake period closes. `brickston-backend` and `pkm-mcp` are kept only for rollback.
5. Update the repository CLAUDE.md files. `brick.apps/CLAUDE.md` still describes `gdm-extractor` as a Cloud Run job, and `brick.intel/CLAUDE.md` still describes `items-hub-causal` as a live Cloud Run job. Both are wrong.

## Where to get help

- [Fly.io Backend](/docs/fly-io-backend) for where every migrated workload landed
- [Architecture](/docs/architecture) for the current topology
- [Neon Database](/docs/neon-database) for the secrets still pulled from Secret Manager
- [Vercel Deployment](/docs/vercel-deployment) for the front ends that replaced the Cloud Run frontend
- Justin owns both GCP projects and the billing decision. Ask before re-enabling anything.
