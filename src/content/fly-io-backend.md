# Fly.io Backend

Fly runs everything in the LFIQ stack that is not a Next.js front end: the Command API, both MCP servers, the batch job dispatcher, and the monitor that watches it. Most of this moved off Google Cloud between July and August 2026, so treat Fly as the default answer for "where does this backend process run".

All apps live in the Fly organization `brickston`, primary region `sjc` (San Jose).

## What runs on Fly

| App | What it does | Public hostname | Always on |
|-----|--------------|-----------------|-----------|
| `brickston-backend` | FastAPI API behind Command and the Brick chat proxy; also the image every batch job runs from | `brickston-backend.fly.dev` | Yes, 1 machine minimum |
| `brick-cron` | Batch dispatcher. Runs supercronic and spawns one-off machines per job | none, liveness only on `:8080` | Yes, 1 machine minimum |
| `brick-cron-monitor` | Self-hosted Healthchecks dead-man's switch watching `brick-cron` | `brick-cron-monitor.fly.dev` | Yes, and it must stay that way |
| `brick-mcp-server` | MCP server exposing the `cockpit_*`, `pkm_*`, `intel_*`, `gallery_*` tools | `brick-mcp.lfiq.app/mcp` | Yes, 1 machine minimum |
| `pkm-mcp` | Keystone MCP server plus its OAuth token endpoint | `keystone-mcp.lfiq.app/mcp` | Yes, 1 machine minimum |
| `lfi-invoice` | LFI retainer invoicing, fires on a scheduled machine | none | No, scheduled machine |
| `brick-gdm` | Image and app the GDM extractor jobs launch into | none | No, launched per run |

Two stale entries appear in `flyctl apps list`. `pkm-mcp-server` is a superseded name for `pkm-mcp` and should not be deployed. `brick-gdm` shows as suspended between runs, which is expected, but verify a recent run landed before trusting `gdm.*` freshness.

Machine sizing:

| App | CPUs | Memory | `auto_stop_machines` |
|-----|------|--------|----------------------|
| `brickston-backend` | 2 shared | 2048 MB | off |
| `brick-cron` | 1 shared | 256 MB | off |
| `brick-mcp-server` | 1 shared | 1024 MB | `stop` |
| `pkm-mcp` | 1 shared | 1024 MB | off |
| `brick-cron-monitor` | 1 shared | 512 MB | off |
| `lfi-invoice` | 1 shared | 512 MB | n/a |

`brick-mcp-server` uses `stop` rather than `suspend` deliberately. Suspend restores from a RAM snapshot and wedged uvicorn on resume on 2026-07-31.

## Prerequisite: a Docker daemon

Every deploy uses `--local-only`, which builds the image on your machine. Docker Desktop is not installed on the Mac. Colima is:

```bash
colima start
export DOCKER_HOST=unix:///Volumes/satopkm/justinsato/.colima/default/docker.sock
docker info    # must succeed before you run flyctl deploy
```

Then authenticate:

```bash
flyctl auth login
flyctl apps list
```

## Deploy runbook

Deploy from `main`. A stale branch will silently revert the object-storage rewire and the Vertex client fix on `brickston-backend`.

**brickston-backend**

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.command/backend
flyctl deploy --app brickston-backend --local-only
```

**brick-cron** (the crontab is baked into the image, so any schedule change needs a redeploy)

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.hub/docs/migration-artifacts/fly/fly-cron
flyctl deploy --app brick-cron --local-only
```

**brick-mcp-server** (the Dockerfile copies from both Keystone and Hub, so the build context is the `brick.apps` parent)

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.apps
flyctl deploy . \
  --config brick.hub/docs/migration-artifacts/fly/brick-mcp-server.fly.toml \
  --dockerfile brick.hub/packages/brick-agent-mcp/Dockerfile.cloudrun \
  --app brick-mcp-server --local-only
```

**pkm-mcp**

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.apps
flyctl deploy brick.keystone \
  --config brick.hub/docs/migration-artifacts/fly/pkm-mcp.fly.toml \
  --app pkm-mcp --local-only
```

**brick-cron-monitor** (public Healthchecks image, no local Dockerfile)

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.hub/docs/migration-artifacts/fly/brick-cron-monitor
flyctl deploy --app brick-cron-monitor --local-only
```

Deploys often end with `i/o timeout to 8.8.8.8`. That is the local resolver, not a failed deploy. Confirm with `flyctl status`.

## Where the configs live

Only `brickston-backend` keeps its `fly.toml` next to its source. Everything else is centralized under Hub's migration artifacts directory.

| App | Config path (relative to `ACTIVE/brick.apps/`) |
|-----|---------------------------------------------------|
| `brickston-backend` | `brick.command/backend/fly.toml` |
| `brick-cron` | `brick.hub/docs/migration-artifacts/fly/fly-cron/fly.toml` |
| `brick-cron-monitor` | `brick.hub/docs/migration-artifacts/fly/brick-cron-monitor/fly.toml` |
| `brick-mcp-server` | `brick.hub/docs/migration-artifacts/fly/brick-mcp-server.fly.toml` |
| `pkm-mcp` | `brick.hub/docs/migration-artifacts/fly/pkm-mcp.fly.toml` |
| `lfi-invoice` | `brick.hub/docs/migration-artifacts/fly/lfi-invoice/fly.toml` |

Nothing about `brick-cron` lives in `brick.command`. Do not go looking for it there.

## Secrets

Fly secrets are set per app and injected as environment variables at boot. They persist across deploys.

```bash
flyctl secrets list -a brickston-backend        # names and status, never values
flyctl secrets set KEY=value -a brickston-backend   # triggers a rolling redeploy
flyctl ssh console -a brickston-backend -C "printenv KEY"   # confirm what is actually set
```

Secret names by app. Values live in GCP Secret Manager and the macOS Keychain; never in a repo.

| App | Secret names |
|-----|--------------|
| `brickston-backend` | `BRICKSTON_DATABASE_URL`, `BRICKSTON_ITEMS_HUB_INGEST_SECRET`, `BRICKSTON_SCHEDULER_SECRET`, `BRICKSTON_PKM_MCP_TOKEN`, `BRICKSTON_PINECONE_API_KEY`, `BRICKSTON_OCP_API_KEY`, `BRICKSTON_BOX_CLIENT_ID`, `BRICKSTON_BOX_CLIENT_SECRET`, `GCP_SA_JSON`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| `brick-cron` | `FLY_API_TOKEN`, `CRON_ENABLED`, `CRON_JOBS` |
| `brick-mcp-server` | `BRICK_MCP_TOKEN`, `DATABASE_URL`, `BRICK_COCKPIT_SCHEDULER_SECRET`, `BRICK_HUB_MCP_ADMIN_SECRET`, `COMMAND_REFRESH_SECRET`, `PKM_MCP_OAUTH_CLIENT_ID`, `PKM_MCP_OAUTH_CLIENT_SECRET` |
| `pkm-mcp` | `PKM_MCP_OAUTH_CLIENT_ID`, `PKM_MCP_OAUTH_CLIENT_SECRET`, `PKM_MCP_PUBLIC_URL`, `PKM_MCP_TOKEN`, `DATABASE_URL` |
| `brick-cron-monitor` | `SECRET_KEY`, `DB_PASSWORD`, `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD` |
| `lfi-invoice` | `MOSSER_TENANT_ID`, `MOSSER_CLIENT_ID`, `DATABASE_URL` |

### The pkm-mcp secret trap

`flyctl secrets list` reports a secret as "Deployed" even when its value is an empty string. The digest does not distinguish. On 2026-07-26 a redeploy of `pkm-mcp` left three OAuth secrets empty while the list command still showed them as present, and the failures looked unrelated to secrets:

- Empty `PKM_MCP_OAUTH_CLIENT_ID` or `PKM_MCP_OAUTH_CLIENT_SECRET` makes `POST /oauth/token` return 500 with "OAuth not configured".
- Empty `PKM_MCP_PUBLIC_URL` makes the server read the scheme off the request, which is `http` behind Fly's TLS edge. `.well-known/oauth-authorization-server` then advertises an `http://` token endpoint, the client POSTs to it, gets a 301 that downgrades POST to GET, and the call fails with 405 Method Not Allowed.

Diagnose by reading the values from inside a machine, not from the list command:

```bash
flyctl ssh console -a pkm-mcp -C "printenv PKM_MCP_PUBLIC_URL"
```

Re-set all three together to fix it. `PKM_MCP_PUBLIC_URL` must be `https://keystone-mcp.lfiq.app`; the stale artifact config sets a `.fly.dev` host and that is wrong.

## Logs, status, and shell

```bash
flyctl status -a brickston-backend     # machines and health checks
flyctl logs -a brickston-backend       # tail
flyctl metrics -a brickston-backend
flyctl machine list --app brickston-backend --json | jq '.[].config.image'
flyctl ssh console -a brickston-backend
flyctl ssh console -a brick-cron -C "cat /app/crontab"
```

`flyctl sftp put` and `flyctl ssh console` can land on different machines when an app runs more than one. To run a script reliably, base64 it into the command rather than uploading it.

## Batch jobs

`brick-cron` is a 256 MB machine running supercronic against a crontab baked into its image. Fly's native cron only handles hourly, daily, and weekly; the schedules here need `*/5` and `*/15`, so supercronic does the scheduling.

Each crontab line calls `run-job.sh <label> <command...>`. That script resolves the currently deployed `brickston-backend` image at runtime and launches a one-off machine from it, which means jobs always run current backend code and inherit the backend's secrets. The machine runs, exits, and is destroyed. This requires `FLY_API_TOKEN` on `brick-cron`, scoped to `brickston-backend`.

Container timezone is America/Los_Angeles.

| Label | Schedule | Command |
|-------|----------|---------|
| `valuation-extractor` | `*/5 * * * *` | `python -m jobs.valuation_extractor.main` |
| `insight-tagger` | `*/15 * * * *` | `python -m jobs.insight_tagger` |
| `pbi-sync` | `0 4 * * *` | `python -m jobs.pbi_sync_job` |
| `valuation-sourcer` | `0 6 * * *` | `python -m jobs.valuation_sourcer.main` |
| `briefing-daily-audio` | `0 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience confidential` |
| `briefing-daily-public` | `15 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience public` |
| `briefing-weekly-soap` | `0 8 * * 1` | `python -m scripts.brick_briefing --kinds video --soap --window-hours 168` |
| `gdm-extractor` | `30 11 * * *` | image entrypoint on `brick-gdm` |
| `gdm-extractor-financials` | `0 5 1,15 * *` | image entrypoint on `brick-gdm` |
| `mobuk-sync` | `30 19 * * 1` | `python -m jobs.mobuk_sync.sync_mobuk` |

`sreo-import-job` has no schedule. Run it by hand:

```bash
flyctl ssh console -a brick-cron -C "/app/run-job.sh sreo python -m jobs.sreo_import_job"
```

### The cron gate

Two secrets gate every job, and both are set through `flyctl secrets` rather than `fly.toml` so they survive redeploys.

| Secret | Effect |
|--------|--------|
| `CRON_ENABLED` | `1` runs jobs. Unset or `0` logs intent and spawns nothing |
| `CRON_JOBS` | Comma-separated labels, or `all`. A label not in the list stays gated even when `CRON_ENABLED=1` |

This is how the migration cut over one wave at a time. It is also the fastest way to stop a misbehaving job without a redeploy:

```bash
flyctl secrets set CRON_ENABLED=0 -a brick-cron
```

### Per-job resources

Shared-CPU machines cap at 2048 MB per CPU. A job that needs more memory needs more CPUs, not just a bigger `--vm-memory`. `run-job.sh` carries per-label overrides; the default is 1 CPU, 1024 MB, and a 30-minute cap. `insight-tagger` overrides to 2 CPUs and 4096 MB.

```bash
flyctl machine run <image> \
  --app brickston-backend --region sjc --restart no --detach \
  --vm-cpu-kind shared --vm-cpus 2 --vm-memory 4096 \
  -- python -m jobs.insight_tagger
```

## Monitoring

`brick-cron-monitor` is a self-hosted Healthchecks instance on its own Fly app, backed by a dedicated `healthchecks` Neon database separate from `neondb`. `brick-cron` pings it on each dispatch cycle. An overdue ping fires a webhook that writes a card to the PKM agent feed.

Its machine must never stop. `auto_stop_machines` is off and `min_machines_running` is 1, because a stopped machine means the alert loop is dead and silence looks identical to success.

## Where to get help

- [Architecture](/docs/architecture) for how the backend fits the app family
- [GCP Cloud Run](/docs/gcp-cloud-run) for what these jobs used to run on and what is left there
- [Neon Database](/docs/neon-database) for the databases these services write
- [Vercel Deployment](/docs/vercel-deployment) for the front ends that call `brickston-backend`
- Justin holds the Fly organization owner account and the deploy token.
