# LFIQ Onboarding Cheat Sheet

One-page quick reference for getting productive in the LFIQ stack. Complete your first 60 minutes using the items below.

## Critical URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Hub | https://hub.lfiq.app | Entry point, document index, Brick chat |
| Intel | https://intel.lfiq.app | Data convergence, inbox, observations |
| Command | https://command.lfiq.app | Portfolio management, properties, leasing |
| Keystone | https://keystone.lfiq.app | PKM, daily briefing, automation dashboard |
| Registry | https://registry.lfiq.app | Deal tracking, opportunities, activities |
| Stacks | https://stacks.lfiq.app | SF sourcing pipeline, dossier, PropertyRadar |
| Sticks | https://sticks.lfiq.app | Personal AI assistant |
| Watch | https://watch.lfiq.app | SF parcel watch: alerts on new DBI complaints and notices of violation |
| Marketing Site | https://leftfieldiq.com | Product overview, investor materials |

Every internal app is a subdomain of `lfiq.app`. The full list of primary domains the company owns, where each one is registered, and which ones are broken is on [Domains](/docs/domains).

## Database & Secrets

| Item | Value/Location | Notes |
|------|--------|-------|
| **Neon Database** | Project `lfiq-command` (`nameless-paper-46385107`), endpoint `ep-hidden-union-aromj80p` | One database, `neondb`. Schemas: portfolio, items, gdm, market, registry, stacks, collect, repair, public, semantic |
| **Auth** | Cloudflare Access on every `<app>.lfiq.app` host | Opening any app redirects to the `lfiq.cloudflareaccess.com` login. Clerk was retired 2026-09-17. App access comes from your row in `items.auth_allowed_users` |
| **Cloudflare** | Account `Left Field` | Workers for Hub, Intel, Command and its sub-apps, Keystone, Registry, Stacks, Sticks, Watch, and `brick-cron-http` |
| **Fly.io** | `brickston-backend`, `brick-cron`, `brick-mcp-server`, `pkm-mcp`, `brick-cron-monitor` | Command backend, batch jobs, MCP servers, cron dead-man's-switch. `brick-gdm` and `brick-leasing-etl` are suspended apps whose images `brick-cron` launches as one-off machines |
| **Secrets** | Worker secrets (`wrangler secret put`), Fly app secrets, macOS Keychain | Names only in docs. Values never in a repo |

## Local Setup (60 seconds)

```bash
# 1. Clone one app repo and install. Each app is its own repo in LFIQ-Git.
git clone https://github.com/LFIQ-Git/brick.intel.git
cd brick.intel
npm ci

# 2. Local secrets: copy the names-only template and fill it in
cp .dev.vars.example .dev.vars
# DATABASE_URL comes from Neon (console Connect, or the Neon MCP get_connection_string
# for project nameless-paper-46385107, lfiq-command). Never commit .dev.vars.

# 3. Verify local development
npm run dev
# Visit http://localhost:3000 (Hub runs on 3040)

# 4. Run health check (Intel, Keystone and Registry have /api/health)
curl http://localhost:3000/api/health
```

## Key Logins & Credentials

### Cloudflare Access Login
- **Perimeter:** Every internal app host redirects to the Cloudflare Access login at `lfiq.cloudflareaccess.com`
- **Grant:** You need an Access policy that admits you and a row in `items.auth_allowed_users`. Ask the platform lead
- **Access:** The row's `apps` array and `is_admin` flag decide which apps you see

### Neon Database Access
- **Endpoint:** `ep-hidden-union-aromj80p` (project `lfiq-command`, `nameless-paper-46385107`)
- **Port:** 5432. There is no local proxy
- **Auth:** Neon roles (intel, command, pkm, gdm_extractor, market_scraper)
- **How to connect:** Pull the connection string from Neon (console Connect, or the Neon MCP `get_connection_string`). It returns the pooled string

### Anthropic API (Claude)
- **Key name:** `ANTHROPIC_API_KEY` in Worker secrets; `BRICKSTON_AI_ANTHROPIC_API_KEY` on Fly `brickston-backend`
- **Apps using it:** Hub (chat), Keystone (automation)
- **Rate limits:** Standard Claude API tiers

### GitHub CLI
- **Setup:** `gh auth login`
- **Used for:** Cloning private repos, opening PRs, checking CI status
- **Token stored:** macOS Keychain

### Fly.io
- **Setup:** `flyctl auth login`
- **Used for:** Deploying brickston-backend, brick-mcp-server
- **Available commands:** `fly deploy`, `fly logs`, `fly status`

## Troubleshooting: Top 3 Issues

### Issue 1: "env vars missing" errors at startup
**Symptom:** App refuses to start, complains about missing NEXT_PUBLIC_* or DATABASE_URL  
**Fix:**  
```bash
# Confirm .dev.vars exists and every name in the template has a value
diff <(grep -oE '^[A-Z_]+' .dev.vars.example | sort) <(grep -oE '^[A-Z_]+' .dev.vars | sort)

# Then restart
npm run dev
```

### Issue 2: "Neon cold start timeout" (40-50s delay on first query)
**Symptom:** First database query hangs for 40+ seconds  
**Fix:**  
```bash
# Warm the connection pool with a dummy query
psql "$DATABASE_URL" -c "SELECT 1;"

# Then retry your app request
```

### Issue 3: Signed in through Access but the app refuses you
**Symptom:** You clear the Cloudflare Access login, then the app sends you to `/login` or returns 403  
**Fix:**  
```sql
-- Your address needs a row, and apps must include the app you are opening
SELECT email, apps, is_admin FROM items.auth_allowed_users WHERE lower(email) = lower('<your email>');
```
Ask the platform lead to add the grant. The `apps` column holds BRICK app slugs and Command sub-app slugs together, so never rewrite it down to one set.

## Learning Path (5 steps)

1. **Read the Architecture Overview** (10 min): Understand the 9-app family, 10 schemas, and data flow
2. **Complete Local Setup** (20 min): Clone, install, fill `.dev.vars`
3. **Watch Hub Demo** (5 min): See the entry point in action
4. **Explore Intel** (15 min): View the inbox, understand how data arrives from the 27 registered sources
5. **Open a PR and Deploy** (15 min): Make a small change, push to a branch, merge to `main` and Workers Builds deploys it

## Common Commands

```bash
# Stream live Worker logs
npx wrangler tail brick-intel

# Check Fly.io app status
flyctl status --app=brickston-backend

# Run tests locally
npm run test

# Start development server (interactive)
npm run dev -- --port 3001

# Push a branch for review
git push origin feature/your-branch

# Deploy to production (Cloudflare Workers Builds)
git push origin main  # triggers auto-deploy
```

## Emergency Contacts

| Role | Email | Slack |
|------|-------|-------|
| Owner / Platform Lead | justin@leftfieldinv.com | @Justin |
| Engineering | team@lfiq.app | #engineering |
| Operations | ops@leftfieldinv.com | #ops |

## Next Steps

- Read **Getting Started → Setup** for detailed local dev instructions
- Read **Architecture** for system overview and deployment topology
- Browse **Apps** for per-app guides (Hub, Intel, Command, Keystone, Registry, Stacks, Sticks)
- Check **Troubleshooting** for less common issues
