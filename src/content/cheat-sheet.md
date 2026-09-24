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
| Marketing Site | https://leftfieldiq.com | Product overview, investor materials |

Every internal app is a subdomain of `lfiq.app`. The full list of primary domains the company owns, where each one is registered, and which ones are broken is on [Domains](/docs/domains).

## Database & Secrets

| Item | Value/Location | Notes |
|------|--------|-------|
| **Neon Database** | Endpoint: `ep-tiny-lab-akrddwgy.us-west-2.neon.tech` | One database, `neondb`. Schemas: portfolio, items, gdm, market, registry, stacks, collect, repair, public, semantic |
| **Clerk Auth** | Sign in at `https://<app>.lfiq.app/login` | Social login only, Google or Microsoft. The route is `/login`, not `/sign-in`. Sticks is the exception and runs NextAuth |
| **GCP Projects** | `brickston-v2`, `graphic-iridium-485814-b2` | Both wound down. Billing disabled on both, so Cloud Scheduler and Cloud Run jobs cannot fire |
| **Vercel Team** | LFIQ (`team_N2zeS1e4gX0Wljbp0aKwkzxb`) | Hub, Intel, Command and its sub-apps, Keystone, Registry, Stacks, Sticks |
| **Fly.io** | `brickston-backend`, `brick-cron`, `brick-mcp-server`, `pkm-mcp` | Command backend, batch jobs, MCP servers |
| **Secrets** | Vercel environment, Fly app secrets, macOS Keychain | Names only in docs. Values never in a repo |

## Local Setup (60 seconds)

```bash
# 1. Clone and install
git clone https://github.com/LFIQ-Git/brick.apps.git
cd brick.apps
mise install
npm ci

# 2. Link to Vercel and pull environment variables
vercel link --project hub
vercel env pull
# This is the whole secret story for local dev. Vercel env is where the values live.

# 3. Verify local development
npm run dev
# Visit http://localhost:3000 (or 3001, 3002, etc. depending on app)

# 4. Run health check
curl http://localhost:3000/api/health
```

## Key Logins & Credentials

### Clerk Login
- **Provider:** Google or Microsoft only. No password login anywhere in the fleet
- **Sign-up:** Restricted to an allowlist of company domains. You must be invited before you can sign in
- **Access:** Clerk org role decides which apps you see. `org:admin` gets everything, `org:member` gets Command

### Neon Database Access
- **Endpoint:** `ep-tiny-lab-akrddwgy.us-west-2.neon.tech`
- **Port:** 5432. There is no local proxy, Cloud SQL was deleted
- **Auth:** Neon roles (intel, command, pkm, gdm_extractor, market_scraper)
- **How to connect:** Use the `DATABASE_URL` pulled from Vercel, not raw credentials

### Anthropic API (Claude)
- **Key name:** `ANTHROPIC_API_KEY`, set in Vercel environment and Fly app secrets
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
# Pull latest from Vercel
vercel env pull

# Confirm the app is linked to the right project first
cat .vercel/project.json

# Then restart
npm run dev
```

### Issue 2: "Neon cold start timeout" (40-50s delay on first query)
**Symptom:** First database query hangs for 40+ seconds  
**Fix:**  
```bash
# Warm the connection pool with a dummy query
psql -h ep-tiny-lab-akrddwgy.us-west-2.neon.tech -U intel neondb -c "SELECT 1;"

# Then retry your app request
```

### Issue 3: "Invalid Clerk claims" in logs
**Symptom:** 403 errors, user cannot authenticate despite valid Clerk session  
**Fix:**  
```bash
# Clear browser cookies for the app domain and the Clerk domain
# In DevTools > Application > Cookies > Delete __session

# Log out and log back in via Clerk UI
# Verify CLERK_SECRET_KEY matches the current Vercel value
vercel env pull
```

Note: production must use a `pk_live_` publishable key. A `pk_test_` key points at a throwaway development Clerk instance and will not recognize your account.

## Learning Path (5 steps)

1. **Read the Architecture Overview** (10 min): Understand the 8-app family, 10 schemas, and data flow
2. **Complete Local Setup** (20 min): Clone, install, link Vercel, pull environment variables
3. **Watch Hub Demo** (5 min): See the entry point in action
4. **Explore Intel** (15 min): View the inbox, understand how data arrives from the 27 registered sources
5. **Open a PR and Deploy** (15 min): Make a small change, push to a branch, deploy via Vercel

## Common Commands

```bash
# View app logs (Vercel)
vercel logs --follow

# Check Fly.io app status
flyctl status --app=brickston-backend

# Run tests locally
npm run test

# Start development server (interactive)
npm run dev -- --port 3001

# Deploy to staging (Vercel)
git push origin feature/your-branch

# Deploy to production (Vercel)
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
