# Keystone App Guide

Keystone is the personal knowledge management (PKM) system for LFIQ. It provides daily briefings, task management, automation orchestration, and a dashboard for personal workflows.

## What It Does

Keystone is a personal operating system for knowledge workers:
- **Daily briefing:** Auto-generated daily summary of portfolio activity, market movements, and observations
- **Tasks:** Personal task management, synced across devices
- **Automation:** Python scripts for ETL, data enrichment, and integrations
- **Dashboard:** Real-time metrics, portfolio summary, market pulse
- **Connections:** OAuth connections to M365, Google, Box, Dropbox, Smartsheet and Zoom
- **MCP server:** Provides pkm_* tools (as surfaced by the Brick MCP) for Claude Code and Anthropic agents

**Primary features:**
- Daily briefing
- Task list (database-backed)
- Automation runner (on-demand, invoked through the MCP server)
- Connections UI at `/connections` (OAuth token management)
- Metrics dashboard

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://keystone.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-keystone` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |
| **Local Worker** | http://localhost:3001 | Via `npm run dev:vinext` | Local machine |
| **MCP Server** | https://keystone-mcp.lfiq.app | Fly app `pkm-mcp` | Remote |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Frontend** | Next.js 16 | React 19, dashboard, task UI, built for Workers with vinext |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Cloudflare Access | `middleware.ts` verifies the Access identity. Authorization is the `items.auth_allowed_users` row. `/api/*` is public in middleware |
| **Database** | Neon (public schema) | Tasks, daily briefing, automation state |
| **Backend** | Python | ETL, briefing generation, automation scripts |
| **MCP Server** | Python on Fly (`pkm-mcp`) | Provides pkm_* tools |
| **Secrets** | Worker secrets, Fly app secrets, macOS Keychain | OAuth tokens, API keys |
| **Deployment** | Cloudflare Workers (frontend), `flyctl deploy` (MCP server) | Workers Builds deploys the frontend on push to main |

## Local Development

### Start the Frontend

```bash
git clone https://github.com/LFIQ-Git/brick.keystone.git
cd brick.keystone
npm run dev
# Runs on http://localhost:3000
```

### Start the Backend (Python Automation)

Keystone's backend is a set of Python automation scripts under `automation/`. They are no longer on a local schedule.

**The local launchd fleet is retired.** All 16 `com.justinsato.*` jobs were unloaded and removed on 2026-06-23, and the plist templates were moved to `automation/launchd/retired/`. The installer refuses to run. `launchctl list` shows zero `com.justinsato.*` entries. Do not reinstate a launchd job to fix a stale feed; that was an intentional decision, not a regression.

Run a script directly:
```bash
cd brick.keystone
.venv/bin/python automation/scripts/<script>.py
```

Scheduled agent work now lives in the MCP scheduled-tasks scheduler (`~/.claude/scheduled-tasks/`) and in the Cowork registry. A task belongs to exactly one of the two. Registering it in both double-fires it.

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `DATABASE_URL` | Yes | Neon connection (public schema, pkm role) |
| `ITEMS_HUB_DATABASE_URL` | Yes | Neon connection for the `items.auth_allowed_users` allowlist |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `true` to bypass the Access gate |
| `ANTHROPIC_API_KEY` | Yes | Claude for briefing generation |
| `CRON_SECRET` | Yes | Bearer token the Worker's cron trigger sends to `/api/cron/carry-score` |
| `PKM_DASHBOARD_URL` | MCP server | Base URL the MCP server posts to for `/api/refresh` |

On the Fly app `pkm-mcp`, three settings do not survive a bare redeploy and have to be re-set, or `/oauth/token` returns a 500:

| Setting | Purpose |
|---------|---------|
| `PKM_MCP_OAUTH_CLIENT_ID` | Client credentials shim |
| `PKM_MCP_OAUTH_CLIENT_SECRET` | Client credentials shim |
| `PKM_MCP_PUBLIC_URL` | Must be the `https://` URL. If unset, the discovery document advertises `http://`, the client's POST gets downgraded to GET on the redirect, and you see a misleading 405 |

For local dev, copy `.dev.vars.example` to `.dev.vars`. Production secrets are Worker secrets: `npx wrangler secret list --name brick-keystone` lists the names, `npx wrangler secret put <NAME> --name brick-keystone` sets one. The Worker's only cron trigger is `5 8 * * *` (carry-score snapshot).

## Daily Briefing Generation

The written briefing lands in the `public.daily_briefing` table. Read [Daily Briefing](/docs/daily-briefing) before relying on its freshness: the local 06:00 producer was retired with the rest of the launchd fleet and there is no confirmed replacement schedule for the written briefing. The three audio and public briefing jobs do run, on Fly `brick-cron`.

The briefing includes:
- Portfolio overview (occupancy, rent, revenue)
- Market movements (rent trends, competitor activity)
- Observations from Intel (high-priority items)
- Lease expirations (next 30 days)
- Maintenance summary (recent work orders)
- Task summary (overdue and due-today items)

**Briefing location:** the `public.daily_briefing` table in Neon. Markdown copies under the PKM daily folder are a disposable projection of that table, not the record.

### How Briefing is Generated

1. **Invoked on demand** through the MCP automation runner, which whitelists the script. The Fly `brick-cron` crontab carries the audio and public briefing labels but not the written one.

2. **Python script** runs queries against Neon:
   - Properties and occupancy (portfolio schema)
   - Recent observations (items schema)
   - Market trends (market schema)
   - Tasks (public schema)

3. **Claude enrichment** (optional):
   - Observations are summarized by Claude
   - Insights are generated (risk alerts, opportunities)
   - Markdown is formatted with headers and tables

4. **Row written** to the `public.daily_briefing` table

5. **Surfaced** on the Keystone dashboard and through the `pkm_get_briefing` MCP tool

## Key Flows

### Flow 1: Generate Daily Briefing
1. An operator or agent invokes the generator through the MCP automation runner
2. Python script queries Neon: properties, leases, observations, tasks
3. Markdown template is rendered with data
4. Claude API enriches insights (optional)
5. Markdown saved to the public.daily_briefing table
6. Dashboard and MCP tools read the new row

### Flow 2: Create Task (via Frontend)
1. User opens keystone.lfiq.app/tasks
2. User clicks "New Task"
3. Form: title, description, due date, priority
4. Submit → INSERT into public.tasks
5. Task appears in task list and daily briefing
6. If due today, notification sent

### Flow 3: Run Automation Script
1. An operator or agent triggers the automation through the MCP `pkm_run_automation` tool, or runs the script directly:
   ```bash
   .venv/bin/python automation/scripts/<script>.py
   ```

2. Python script runs (ETL, data enrichment, etc.)
3. Results logged to the automation log directory
4. Output saved to Neon or an external service
5. Errors surface in `public.agent_feed`, which Keystone shows as unread

## Automation Scripts

Keystone's automation directory contains reusable Python scripts:

```
brick.keystone/automation/
├── scripts/
│   ├── daily_briefing.py           # Daily briefing
│   └── ...
├── mcp_server.py                   # MCP server
└── requirements.txt                # Python dependencies
```

### Running an Automation Script Locally

```bash
cd brick.keystone

# Install Python dependencies
.venv/bin/pip install -r automation/requirements.txt

# Run a script. Environment comes from .env.local
.venv/bin/python automation/scripts/daily_briefing.py
```

## MCP Server (keystone-mcp)

Keystone provides an MCP server that exposes the pkm_* tools for Claude Code and Anthropic agents. This allows agents to:
- Query tasks and projects
- Create and update tasks
- Query portfolio data
- Access briefing data
- Run automations

### Accessing MCP Tools

In Claude Code or an agent:
```
/brick pkm_get_dashboard_state
```

This calls the Keystone MCP server and returns current PKM state.

### Server Location

- **Production:** https://keystone-mcp.lfiq.app, served by the Fly app `pkm-mcp` (org brickston, region sjc)
- **Source:** `brick.keystone/automation/mcp_server.py`

## Troubleshooting

### Issue 1: "Daily briefing is stale"
**Symptom:** The briefing on the dashboard is days old  
**Cause:** Expected. The scheduled local producer was retired on 2026-06-23 and no replacement schedule for the written briefing has been confirmed  
**Fix:**
```bash
# Check what the table actually holds
psql "$DATABASE_URL" -c \
  "SELECT briefing_date, length(content) FROM public.daily_briefing ORDER BY briefing_date DESC LIMIT 5;"

# Generate one on demand
python3 automation/scripts/daily_briefing.py
```
Do not reinstate a launchd job to fix this. See [Daily Briefing](/docs/daily-briefing).

### Issue 2: "Connector data is stale"
**Symptom:** M365 or another connected account stops producing rows  
**Cause:** The OAuth token expired. Keystone brokers the tokens, Intel's `connections-pull` cron does the fetching  
**Fix:**
```bash
# Re-authorize in the UI
# Visit keystone.lfiq.app/connections and reconnect the account

# Then re-run the pull from the Intel side
curl "https://intel.lfiq.app/api/cron/connections-pull?secret=$INGEST_SECRET"
```

### Issue 3: "MCP server returns 500 or a 405 on /oauth/token"
**Symptom:** Claude Code cannot connect to the pkm_* tools  
**Cause:** A redeploy of the Fly app `pkm-mcp` dropped the three OAuth settings listed above  
**Fix:**
```bash
flyctl status -a pkm-mcp
flyctl secrets list -a pkm-mcp

# Re-set the three that do not survive a redeploy (names only, values from the menubar config)
flyctl secrets set PKM_MCP_OAUTH_CLIENT_ID=... PKM_MCP_OAUTH_CLIENT_SECRET=... \
  PKM_MCP_PUBLIC_URL=https://keystone-mcp.lfiq.app -a pkm-mcp
```
A `400 Missing session ID` from `/mcp` is normal protocol behavior without an `initialize` handshake, not an auth failure.

### Issue 4: "Database role 'pkm' sees zero rows and no error"
**Symptom:** A query returns nothing, with no permission error  
**Cause:** Row-Level Security. Several `public.*` tables have RLS enabled, and a grant alone is not enough. Each role needs its own policy  
**Fix:**
```sql
-- Apply as neondb_owner, not through the app-role migration runner
CREATE POLICY pkm_all ON public.<table> FOR ALL TO pkm USING (true) WITH CHECK (true);
```

## Common Tasks

### Task 1: Generate Briefing On-Demand
```bash
cd brick.keystone
python3 automation/scripts/daily_briefing.py
```

### Task 2: Query Task List
```sql
SELECT id, title, due_date, status, priority
FROM public.tasks
WHERE status = 'open' AND due_date <= now() + interval '7 days'
ORDER BY due_date ASC;
```

### Task 3: Refresh Connected M365 Data
The M365 pull runs on the Intel side, not from Keystone. Keystone brokers the OAuth token; Intel's `connections-pull` cron does the fetching.

```bash
curl "https://intel.lfiq.app/api/cron/connections-pull?secret=$INGEST_SECRET"
```

## Related Documentation

- **Architecture:** PKM data topology, MCP server, daily briefing workflow
- **Getting Started:** Setup, Logins, Install Tools
- **Brick MCP:** Using pkm_* tools in Claude Code
- [Daily Briefing](/docs/daily-briefing)
- [Fly.io Backend](/docs/fly-io-backend)
