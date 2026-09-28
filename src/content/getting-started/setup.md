# Getting Started: Local Development Setup

Step-by-step guide to clone the LFIQ app repos, install dependencies, configure secrets, and verify your development environment.

## Prerequisites

Before starting, ensure you have:
- **macOS** (Ventura or later)
- **Git** (installed via Xcode Command Line Tools)
- **GitHub CLI** (`gh` command installed)
- **GitHub account** with access to LFIQ-Git organization
- **Cloudflare account** with access to the Left Field Investments account, for `npx wrangler` against the Workers
- **An `items.auth_allowed_users` row**: a `brick_admin` has to add your email before you can use any app. Cloudflare Access only proves who you are
- **colima** if you will deploy to Fly. Fly builds locally and needs a Docker daemon
- **Fly.io account** (for viewing logs of brickston-backend)

You do not need a local Postgres and you do not need a database proxy. Apps connect straight to Neon.

## Step 1: Clone & Install Dependencies

### 1a. Clone the app repos
Each app is its own repository. The `brick.apps` superproject still exists on GitHub, but its submodules are not used for day-to-day work; clone the app repos you need directly.
```bash
gh repo clone LFIQ-Git/brick.hub
gh repo clone LFIQ-Git/brick.command
gh repo clone LFIQ-Git/brick.intel
# ...and brick.keystone, brick.registry, brick.stacks, brick.sticks as needed
```
Hub's app lives in the `hub/` subdirectory of `brick.hub`. Command is an npm workspaces repo with `apps/web` plus the sub-apps under `apps/`.

### 1b. Install Node and Python versions via mise
```bash
# Install mise (if not already installed)
curl https://mise.jdx.dev/install.sh | sh

# Install Node 22 and Python 3.11 (run inside brick.command, which has mise.toml)
mise install

# Verify versions
node --version  # v22.x.x
python --version  # Python 3.11.x
```

### 1c. Install npm dependencies
Run this in each app directory (for Hub, inside `brick.hub/hub`; for Command, at the `brick.command` root):
```bash
npm ci
# This respects the package-lock.json exactly (better for CI/team consistency)
```

## Step 2: Authenticate with GitHub

```bash
gh auth login
# Follow prompts to authenticate
# Choose: HTTPS, login with browser, paste device code

# Verify authentication
gh auth status
```

## Step 3: Understand Where Secrets Live

There is no shared secrets directory to populate. Every value an app needs comes from one of these places:

| Surface | What lives there | How you get it |
|---------|------------------|----------------|
| Cloudflare Worker secrets | Web app credentials, set with `wrangler secret put` or `wrangler secret bulk` | `npx wrangler secret list --name <worker>` shows names, never values |
| Worker `vars` in `wrangler.jsonc` / `wrangler.toml` | Non-secret config such as `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` | Read the file |
| Neon | Database connection strings | Neon console, **Connect** |
| Fly app secrets | Backend and job configuration for `brickston-backend`, `brick-cron`, and the MCP apps | `flyctl secrets list` shows names, never values |
| macOS Keychain | Local operator credentials such as the Fly deploy token | Keychain Access |

Secret **names** are safe to write down and appear throughout this manual. Values never go in a repo, a doc, or a chat message.

`flyctl secrets list` marks a secret as "Deployed" even when its value is an empty string. The digest does not distinguish. If a secret looks set but the app behaves as if it is missing, check inside the machine with `printenv`.

## Step 4: Create Your Local Environment File

Each app is deployed as a Cloudflare Worker. Worker secret values cannot be read back out of Cloudflare, so there is nothing to pull. Copy the repo's template and fill in the values you need:

```bash
cp .env.example .env.local
```

Repos that run locally under Wrangler or vinext also ship `.dev.vars.example` (Intel, Keystone, Registry, Stacks, Watch). Copy it to `.dev.vars` for those runs. Never commit `.env.local` or `.dev.vars`.

To see which secrets a deployed Worker actually has (names only):
```bash
npx wrangler secret list --name brick-intel
```

Pull `DATABASE_URL` from the Neon console. For anything else, ask a `brick_admin` rather than copying values from another repo's committed file.

## Step 5: Verify Local Development Environment

### 5a. Start the Hub app (default)
```bash
cd /path/to/brick.hub/hub
BRICK_AUTH_DISABLED=true npm run dev
# Hub's dev script is `next dev --port 3040`
# - Local: http://localhost:3040
```

Locally there is no Cloudflare Access in front of the app, so the gate has nothing to verify. `BRICK_AUTH_DISABLED=true` bypasses it outside production. See [Cloudflare Access](/docs/access-auth) for what the bypass does.

### 5b. Health check
Hub has no health route. Intel, Keystone, Registry and Sticks expose `/api/health`:
```bash
# From a running Intel dev server, in another terminal
curl http://localhost:3000/api/health
```

### 5c. Open in browser
Navigate to http://localhost:3040. With the bypass on you land on the Hub home page with a synthetic operator that has every app unlocked.

### 5d. Test production sign-in
- Open https://hub.lfiq.app. Cloudflare Access intercepts the request and redirects to `lfiq.cloudflareaccess.com`
- Sign in with Google, Microsoft Entra ID, or the emailed one-time code
- If you clear Access but see "Access not enabled", your email has no `items.auth_allowed_users` row. A `brick_admin` has to add it

## Step 6: Set Up Other Apps (Repeat as Needed)

Once Hub is verified, set up the other apps. Each follows the same pattern: `npm ci`, `cp .env.example .env.local`, fill in values, then `npm run dev`. Only Hub pins a port. Every other app runs plain `next dev`, which serves on http://localhost:3000, so run one at a time or pass `-- --port <n>`.

```bash
# Intel
cd /path/to/brick.intel && npm ci && npm run dev

# Command (root script runs the web workspace)
cd /path/to/brick.command && npm ci && npm run dev

# Keystone
cd /path/to/brick.keystone && npm ci && npm run dev

# Registry
cd /path/to/brick.registry && npm ci && npm run dev

# Stacks
cd /path/to/brick.stacks && npm ci && npm run dev

# Sticks
cd /path/to/brick.sticks && npm ci && npm run dev
```

## Troubleshooting Common Errors

### Error 1: "Module not found: next/font/google"
**Symptom:** `npm run dev` fails with module resolution error  
**Cause:** Next.js version mismatch or incomplete npm install  
**Fix:**
```bash
rm -rf node_modules package-lock.json
npm ci
npm run dev
```

### Error 2: "ENOENT: no such file or directory, open .env.local"
**Symptom:** App starts but complains about missing .env.local  
**Cause:** the local env file was never created  
**Fix:**
```bash
cp .env.example .env.local
# fill in values, then
npm run dev
```

### Error 3: "Connection timeout on Neon database"
**Symptom:** Queries hang for 40+ seconds, then timeout  
**Cause:** Neon cold start or network connectivity  
**Fix:**
```bash
# Neon suspends an idle endpoint. Warm it, then retry.
psql "$DATABASE_URL" -c "SELECT 1;"
```
See [Neon Debugging](/docs/neon-debugging).

### Error 4: "Cannot find module '@brick/ui'"
**Symptom:** TypeScript error about shared UI package  
**Cause:** Workspace linking not resolved. `@brick/ui` lives in `brick.command/packages/ui`  
**Fix:**
```bash
cd /path/to/brick.command
npm ci
npm run dev
```

## What's Next?

- Browse the **Architecture** guide to understand the 8-app family and data topology
- Read the **Hub** guide to learn the entry point interface and chat proxy
- Read **Intel** to understand data ingestion from the 27 registered sources
- Read **Command** for portfolio management workflows
- Open a pull request to verify your Git + Workers Builds setup end-to-end
