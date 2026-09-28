# Fly.io Backend

Fly runs everything in the LFIQ stack that is not a Cloudflare Worker front end: the Command API, both MCP servers, the batch job dispatcher, the monitor that watches it, and the images the GDM and leasing jobs launch from. Treat Fly as the default answer for "where does this backend process run".

All apps live in the Fly organization `brickston`, primary region `sjc` (San Jose).

## What runs on Fly

| App | What it does | Public hostname | Always on |
|-----|--------------|-----------------|-----------|
| `brickston-backend` | FastAPI API behind Command and the Brick chat proxy; also the image most batch jobs run from | `brickston-backend.fly.dev` | Yes, 1 machine minimum (2 running as of 2026-09-27) |
| `brick-cron` | Batch dispatcher. Runs supercronic and spawns one-off machines per job | none, liveness only on `:8080` | Yes, 1 machine minimum |
| `brick-cron-monitor` | Self-hosted Healthchecks dead-man's switch watching `brick-cron` | `brick-cron-monitor.fly.dev` | Yes, and it must stay that way |
| `brick-mcp-server` | MCP server exposing the `cockpit_*`, `pkm_*`, `intel_*` and related tools (`gallery_*` is denied through the `BRICK_TOOL_DENY` secret since the Gallery was retired) | `brick-mcp.lfiq.app/mcp` | Yes, 1 machine minimum |
| `pkm-mcp` | Keystone MCP server plus its OAuth token endpoint | `keystone-mcp.lfiq.app/mcp` | Yes, 1 machine minimum |
| `brick-gdm` | Image and app the GDM extractor jobs launch into | none | No, launched per run |
| `brick-leasing-etl` | Image and app the `leasing-*` competitor-intel scrape jobs launch into | none | No, launched per run |

`brick-gdm` and `brick-leasing-etl` both show as suspended in `flyctl apps list`. Neither keeps an always-on machine; `brick-cron` launches one-off machines from their images. Do not read suspended as healthy, though. `brick.apps/CLAUDE.md` records that the Intel `pbi` source has had no GDM run since 2026-09-10. Verify a recent run landed before trusting `gdm.*` or `market.*` freshness. As of 2026-09-27 every secret on `brick-leasing-etl` and `brick-gdm` shows `Staged` rather than `Deployed` in `flyctl secrets list`. `pkm-mcp-server` is a superseded name for `pkm-mcp` and no longer appears in the app list; its artifact config is still on disk and should not be deployed.

`lfi-invoice` no longer exists. It was destroyed on 2026-09-06 after invoicing moved into `lfi.home`. Do not redeploy it: a second sender would bill the same period twice.

Machine sizing:

| App | CPUs | Memory | `auto_stop_machines` |
|-----|------|--------|----------------------|
| `brickston-backend` | 2 shared | 2048 MB | off |
| `brick-cron` | 1 shared | 256 MB | off |
| `brick-mcp-server` | 1 shared | 1024 MB | `stop` (min 1 running) |
| `pkm-mcp` | 1 shared | 1024 MB | off |
| `brick-cron-monitor` | 1 shared | 512 MB | off |
| `brick-leasing-etl` job machines | 2 shared | 2048 MB | n/a, one-off |

`brick-mcp-server` uses `stop` rather than `suspend` deliberately. Suspend restores from a RAM snapshot and wedged uvicorn on resume on 2026-07-31.

## Prerequisite: a Docker daemon

Most deploys below use `--local-only`, which builds the image on your machine. Docker Desktop is not installed on the Mac. Colima is:

```bash
colima start
export DOCKER_HOST=unix:///Volumes/minibase/justinsato/.colima/default/docker.sock
docker info    # must succeed before you run flyctl deploy
```

Then authenticate:

```bash
flyctl auth login
flyctl apps list
```

## Deploy runbook

Deploy from `main`. A stale branch on `brickston-backend` will silently revert fixes that exist only on `main`, including the R2 object-storage rewire.

Each app is a standalone clone under `/Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/`. The `brick.apps` superproject is not a usable build context: its submodules are not initialized locally.

**brickston-backend**

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.command/backend
flyctl deploy --app brickston-backend --local-only
```

**brick-cron** (the crontab is baked into the image, so any schedule change needs a redeploy)

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.hub/docs/migration-artifacts/fly/fly-cron
flyctl deploy --app brick-cron --local-only
```

**brick-mcp-server** (the Dockerfile copies from both `brick.keystone` and `brick.hub`, so the build context is the directory that holds both clones; the config's `[build]` block names the Dockerfile)

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick
flyctl deploy . \
  --config brick.hub/docs/migration-artifacts/fly/brick-mcp-server.fly.toml \
  --app brick-mcp-server --local-only
```

**pkm-mcp**

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick
flyctl deploy brick.keystone \
  --config brick.hub/docs/migration-artifacts/fly/pkm-mcp.fly.toml \
  --app pkm-mcp --local-only
```

**brick-cron-monitor** (public Healthchecks image, no local Dockerfile)

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.hub/docs/migration-artifacts/fly/brick-cron-monitor
flyctl deploy --app brick-cron-monitor --local-only
```

**brick-leasing-etl** (image only, per the header of its `fly.toml`)

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.command
flyctl deploy apps/leasing --config apps/leasing/fly.toml --app brick-leasing-etl --remote-only
```

**brick-gdm** (image only) builds from `brick.intel/jobs/gdm-extractor/`, which holds its `fly.toml` and `Dockerfile`.

Deploys often end with `i/o timeout to 8.8.8.8`. That is the local resolver, not a failed deploy. Confirm with `flyctl status`.

## Where the configs live

`brickston-backend`, `brick-leasing-etl` and `brick-gdm` keep their `fly.toml` next to their source. Everything else is centralized under Hub's migration artifacts directory.

| App | Config path (relative to `ACTIVE/apps/brick/`) |
|-----|---------------------------------------------------|
| `brickston-backend` | `brick.command/backend/fly.toml` |
| `brick-cron` | `brick.hub/docs/migration-artifacts/fly/fly-cron/fly.toml` |
| `brick-cron-monitor` | `brick.hub/docs/migration-artifacts/fly/brick-cron-monitor/fly.toml` |
| `brick-mcp-server` | `brick.hub/docs/migration-artifacts/fly/brick-mcp-server.fly.toml` |
| `pkm-mcp` | `brick.hub/docs/migration-artifacts/fly/pkm-mcp.fly.toml` |
| `brick-leasing-etl` | `brick.command/apps/leasing/fly.toml` |
| `brick-gdm` | `brick.intel/jobs/gdm-extractor/fly.toml` |

Nothing about `brick-cron` lives in `brick.command`. Do not go looking for it there.

## Secrets

Fly secrets are set per app and injected as environment variables at boot. They persist across deploys.

```bash
flyctl secrets list -a brickston-backend        # names and status, never values
flyctl secrets set KEY=value -a brickston-backend   # triggers a rolling redeploy
flyctl ssh console -a brickston-backend -C "printenv KEY"   # confirm what is actually set
```

Secret names by app, as `flyctl secrets list` reported them on 2026-09-27. Values are set with `flyctl secrets set` and never live in a repo.

| App | Secret names |
|-----|--------------|
| `brickston-backend` | `BRICKSTON_DATABASE_URL`, `BRICKSTON_ITEMS_HUB_DATABASE_URL`, `BRICKSTON_KEYSTONE_DATABASE_URL`, `BRICKSTON_LEASING_INTEL_DATABASE_URL`, `BRICKSTON_ITEMS_HUB_INGEST_SECRET`, `BRICKSTON_SCHEDULER_SECRET`, `SCHEDULER_SECRET`, `BRICKSTON_MCP_RESOLVER_SECRET`, `BRICKSTON_AI_ANTHROPIC_API_KEY`, `BRICKSTON_AI_OCP_API_KEY`, `BRICKSTON_AI_OCP_CF_ACCESS_CLIENT_ID`, `BRICKSTON_AI_OCP_CF_ACCESS_CLIENT_SECRET`, `BRICKSTON_AI_DRAW_SEARCH_BACKEND`, `BRICKSTON_PINECONE_API_KEY`, `BRICKSTON_PINECONE_INDEX_HOST`, `BRICKSTON_SEMANTIC_READ_BACKEND`, `BRICKSTON_BOX_CLIENT_ID`, `BRICKSTON_BOX_CLIENT_SECRET`, `BRICKSTON_BOX_DEVELOPER_TOKEN`, `BRICKSTON_BOX_UPLOAD_FOLDER_ID`, `BRICKSTON_SMARTSHEET_TOKEN`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BRIEFINGS_BUCKET`, `NOTEBOOKLM_STORAGE`, `NOTEBOOKLM_STORAGE_JSON`, `NOTEBOOKLM_STORAGE_R2`, `STACKS_BASE_URL`, `STACKS_SERVICE_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_AI_TOKEN`, `VOYAGE_API_KEY`, `client_id`, `client_secret` |
| `brick-cron` | `FLY_API_TOKEN`, `CRON_ENABLED`, `CRON_JOBS` (shown as `Staged`), `BRICKSTON_SCHEDULER_SECRET` |
| `brick-mcp-server` | `BRICK_MCP_TOKEN`, `DATABASE_URL`, `BRICK_COCKPIT_SCHEDULER_SECRET`, `BRICK_HUB_MCP_ADMIN_SECRET`, `BRICK_MACHINE_ADMIN_SECRET`, `BRICK_MCP_RESOLVER_SECRET`, `COMMAND_REFRESH_SECRET`, `PKM_MCP_OAUTH_CLIENT_ID`, `PKM_MCP_OAUTH_CLIENT_SECRET`, `BRICK_INTEL_INGEST_SECRET`, `BRICK_INTEL_CF_ACCESS_CLIENT_ID`, `BRICK_INTEL_CF_ACCESS_CLIENT_SECRET`, `BRICK_OPERATOR_EMAIL`, `BRICK_TOOL_DENY` |
| `pkm-mcp` | `PKM_MCP_OAUTH_CLIENT_ID`, `PKM_MCP_OAUTH_CLIENT_SECRET`, `PKM_MCP_PUBLIC_URL`, `PKM_MCP_TOKEN`, `PKM_DATABASE_URL`, `PKM_SECRET_M365`, `PKM_SECRET_M365_CLIENT_SECRET`, `PKM_SECRET_M365_LFI` |
| `brick-cron-monitor` | `SECRET_KEY`, `DB_PASSWORD`, `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD` |
| `brick-gdm` | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `PBI_WORKSPACE_ID`, `PBI_DATASET_ID`, `GDM_SKIP`, `NEON_DATABASE_URL` |
| `brick-leasing-etl` | `LEASING_DATABASE_URL_UNPOOLED`, `DATABASE_URL_UNPOOLED`, `CF_ACCOUNT_ID`, `CF_BROWSER_RENDERING_TOKEN`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |

A secret that shows `Staged` has been set but not rolled out to the app's machines. `flyctl secrets deploy -a <app>` rolls it out. A one-off machine that `brick-cron` launches reads the app's secrets but not its `fly.toml` `[env]` block, so any plain variable a job needs is passed explicitly in `run-job.sh`.

### The pkm-mcp secret trap

`flyctl secrets list` reports a secret as "Deployed" even when its value is an empty string. The digest does not distinguish. On 2026-07-26 a redeploy of `pkm-mcp` left three OAuth secrets empty while the list command still showed them as present, and the failures looked unrelated to secrets:

- Empty `PKM_MCP_OAUTH_CLIENT_ID` or `PKM_MCP_OAUTH_CLIENT_SECRET` makes `POST /oauth/token` return 500 with "OAuth not configured".
- Empty `PKM_MCP_PUBLIC_URL` makes the server read the scheme off the request, which is `http` behind Fly's TLS edge. `.well-known/oauth-authorization-server` then advertises an `http://` token endpoint, the client POSTs to it, gets a 301 that downgrades POST to GET, and the call fails with 405 Method Not Allowed.

Diagnose by reading the values from inside a machine, not from the list command:

```bash
flyctl ssh console -a pkm-mcp -C "printenv PKM_MCP_PUBLIC_URL"
```

Re-set all three together to fix it. `PKM_MCP_PUBLIC_URL` must be `https://keystone-mcp.lfiq.app`; the stale `pkm-mcp-server.fly.toml` artifact sets a `.fly.dev` host and that is wrong.

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

`brick-cron` is a 256 MB machine running supercronic against a crontab baked into its image. Fly's native cron only handles hourly, daily, weekly and monthly; the schedules here need `*/5` and `*/30`, so supercronic does the scheduling.

`brick-cron` runs batch jobs only. The 29 HTTP service jobs that POST to `brickston-backend` moved to the Cloudflare `brick-cron-http` Worker on 2026-09-23, and the image build fails if a `run-http.sh` line comes back into the crontab. See [Cloudflare Deployment](/docs/cloudflare-deployment#cron-triggers).

Each crontab line calls `run-job.sh <label> <command...>`. For most labels that script resolves the currently deployed `brickston-backend` image at runtime and launches a one-off machine from it, which means jobs always run current backend code and inherit the backend's secrets. `gdm-extractor*` labels run on the `brick-gdm` image and `leasing-*` labels on the `brick-leasing-etl` image. The machine runs, exits, and is destroyed. `run-job.sh` reads the machine's exit code before destroying it and records a failure for a non-zero exit or a run that never exits. This requires `FLY_API_TOKEN` on `brick-cron`. Since 2026-08-24 it is a 10-year org token named `brick-cron-dispatcher`; the short-lived token before it expired around 2026-08-07 and every dispatch failed silently for 17 days.

Container timezone is America/Los_Angeles.

| Label | Schedule | Command |
|-------|----------|---------|
| `valuation-extractor` | `*/5 * * * *` | `python -m jobs.valuation_extractor.main` |
| `insight-tagger` | `*/30 * * * *` | `python -m jobs.insight_tagger` |
| `pbi-sync` | `0 4 * * *` | `python -m jobs.pbi_sync_job` |
| `valuation-sourcer` | `0 6 * * *` | `python -m jobs.valuation_sourcer.main` |
| `briefing-daily-audio` | `0 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience confidential --out-dir /tmp/briefings` |
| `briefing-daily-public` | `15 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience public --out-dir /tmp/briefings` |
| `briefing-weekly-soap` | `0 8 * * 1` | `python -m scripts.brick_briefing --kinds video --soap --window-hours 168 --out-dir /tmp/briefings` |
| `gdm-extractor` | `30 11 * * *` | image entrypoint on `brick-gdm` |
| `gdm-extractor-financials` | `0 5 1,15 * *` | image entrypoint on `brick-gdm` |
| `mobuk-sync` | `30 19 * * 1` | `python -m jobs.mobuk_sync.sync_mobuk` |
| `leasing-operator-scrape` | `0 1,13 * * *` | `python -m etl.main --write --skip-cl` on `brick-leasing-etl` |
| `leasing-cl-scrape` | `0 1,13 * * *` | `python -m etl.cl_pipeline` on `brick-leasing-etl` |
| `leasing-owner-mirror` | `30 3 * * *` | `python -m etl.mirror_owner_manager` on `brick-leasing-etl` |
| (reaper) | `12 * * * *` | `/app/reap-orphans.sh`, not gated; destroys stopped one-off machines older than an hour |

`sreo-import-job` has no schedule. Run it by hand:

```bash
flyctl ssh console -a brick-cron -C "/app/run-job.sh sreo python -m jobs.sreo_import_job"
```

### The cron gate

Two secrets gate every job, and both are set through `flyctl secrets` rather than `fly.toml` so they survive redeploys.

| Secret | Effect |
|--------|--------|
| `CRON_ENABLED` | `1` runs jobs. Unset or `0` logs intent and spawns nothing |
| `CRON_JOBS` | Comma-separated labels, or `all`. A label not in the list stays gated even when `CRON_ENABLED=1` and logs `GATED OFF` while exiting 0, so adding a crontab line without adding its label here looks scheduled and never runs |

This is how the migration cut over one wave at a time. It is also the fastest way to stop a misbehaving job without a redeploy:

```bash
flyctl secrets set CRON_ENABLED=0 -a brick-cron
```

### Per-job resources

Shared-CPU machines cap at 2048 MB per CPU. A job that needs more memory needs more CPUs, not just a bigger `--vm-memory`. `run-job.sh` carries per-label overrides; the default is 1 CPU, 1024 MB, and a 30-minute cap. `insight-tagger` overrides to 2 CPUs and 4096 MB. `leasing-*` use 2 CPUs, 2048 MB and a 60-minute cap. `gdm-extractor*` use a 60-minute cap. `briefing-*` use 2048 MB.

```bash
flyctl machine run <image> \
  --app brickston-backend --region sjc --restart no --detach \
  --vm-cpu-kind shared --vm-cpus 2 --vm-memory 4096 \
  -- python -m jobs.insight_tagger
```

## Monitoring

`brick-cron-monitor` is a self-hosted Healthchecks instance on its own Fly app, backed by a dedicated `healthchecks` Neon database separate from `neondb`. Its `fly.toml` describes the design: the dispatcher pings it each cycle and an overdue ping fires a webhook that writes a card to the PKM agent feed. The current `fly-cron` scripts contain no such ping, so do not assume a silent monitor means healthy jobs.

The heartbeat that is wired up lives on `brick-cron` itself. `run-job.sh` writes `<ts> <label>` to `https://brick-cron.fly.dev/last-success` on a clean exit and to `/last-failure` on a failure, and the `brick-cron-dispatcher-monitor` scheduled task alerts when `last-success` goes stale. For Command service jobs, query `portfolio.scheduled_job_runs`.

Its machine must never stop. `auto_stop_machines` is off and `min_machines_running` is 1, because a stopped machine means the alert loop is dead and silence looks identical to success.

## Where to get help

- [Architecture](/docs/architecture) for how the backend fits the app family
- [Cloudflare Deployment](/docs/cloudflare-deployment) for the Workers, including `brick-cron-http`
- [Neon Database](/docs/neon-database) for the databases these services write
- Justin holds the Fly organization owner account and the deploy token.
