# Getting Started: Local Development Setup

Step-by-step guide to clone the LFIQ monorepo, install dependencies, configure secrets, and verify your development environment.

## Prerequisites

Before starting, ensure you have:
- **macOS** (Ventura or later)
- **Git** (installed via Xcode Command Line Tools)
- **GitHub CLI** (`gh` command installed)
- **GitHub account** with access to LFIQ-Git organization
- **Vercel account** on the LFIQ team, linked to GitHub. This is where environment variables come from
- **Clerk access**: you must be invited before you can sign in to any app
- **colima** if you will deploy to Fly. Fly builds locally and needs a Docker daemon
- **Fly.io account** (for viewing logs of brickston-backend)

You do not need a local Postgres and you do not need a database proxy. Apps connect straight to Neon.

## Step 1: Clone & Install Dependencies

### 1a. Clone the monorepo
```bash
git clone https://github.com/LFIQ-Git/brick.apps.git
cd brick.apps
```

### 1b. Install Node and Python versions via mise
```bash
# Install mise (if not already installed)
curl https://mise.jdx.dev/install.sh | sh

# Install Node 20 and Python 3.11
mise install

# Verify versions
node --version  # v20.x.x
python --version  # Python 3.11.x
```

### 1c. Install npm dependencies
```bash
npm ci
# This respects the package-lock.json exactly (better for CI/team consistency)
```

**Expected output:**
```
added 2000+ packages, and audited 2,345 packages in 15s
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

There is no local secrets directory to populate and nothing to fetch from a GCP console. Every value an app needs comes from one of three places:

| Surface | What lives there | How you get it |
|---------|------------------|----------------|
| Vercel environment | All web app configuration, including database URLs and Clerk keys | `vercel env pull` |
| Fly app secrets | Backend and job configuration for `brickston-backend`, `brick-cron`, and the MCP apps | `flyctl secrets list` shows names, never values |
| macOS Keychain | Local operator credentials such as the Fly deploy token | Keychain Access |

Secret **names** are safe to write down and appear throughout this manual. Values never go in a repo, a doc, or a chat message.

`flyctl secrets list` marks a secret as "Deployed" even when its value is an empty string. The digest does not distinguish. If a secret looks set but the app behaves as if it is missing, check inside the machine with `printenv`.

## Step 4: Link Vercel & Pull Environment Variables

Each app in the monorepo is deployed via Vercel. Link your local checkout to the Vercel projects, then pull the environment variables.

### 4a. Link to Vercel
From the monorepo root:
```bash
vercel link --project hub
# Select: Link to existing project
# Choose: lfiq / hub
```

### 4b. Pull environment variables
```bash
vercel env pull
# Creates .env.local in the current app directory
# Pulls NEXT_PUBLIC_* and other build-time variables
```

Repeat for each app (if developing on multiple):
```bash
# From brick.apps/apps/hub
vercel link --project hub && vercel env pull

# From brick.apps/apps/intel
vercel link --project intel && vercel env pull

# From brick.apps/apps/command
vercel link --project command && vercel env pull

# ... and so on for keystone, registry, stacks, sticks
```

## Step 5: Verify Local Development Environment

### 5a. Start the Hub app (default)
```bash
cd /path/to/brick.apps/apps/hub
npm run dev
# Expected output:
# ▲ Next.js 15.0.0
# - Local: http://localhost:3000
# - Environments: .env.local
```

### 5b. Health check
```bash
# In another terminal
curl http://localhost:3000/api/health
# Expected: {"status": "ok"}
```

### 5c. Open in browser
Navigate to http://localhost:3000 in your browser. You should see:
- Hub splash page (public, no login required initially)
- "Sign in with Google" or "Sign in with Microsoft" button
- The hosted Clerk sign-in flow

### 5d. Test Clerk authentication
- Click "Sign in with Google" or "Sign in with Microsoft". There is no password option anywhere in the fleet
- Use a company account. Sign-up is restricted to an allowlist of company domains, so a personal account will not provision
- After login, you should see the Hub home page with document index
- Profile menu in top-right corner

If you are signed in but see an access-denied page, you are authenticated but not authorized. A `brick_admin` has to grant your Clerk org role. See [Clerk Authentication](/docs/clerk-auth).

Note that Hub's checked-in `.env.local` carries a `pk_test_` publishable key pointing at a throwaway development Clerk instance. The production `pk_live_` key exists only in the Vercel environment, which is another reason to run `vercel env pull` rather than trusting a committed file.

## Step 6: Set Up Other Apps (Repeat as Needed)

Once Hub is verified, set up the other apps. Each follows the same pattern:

```bash
# Intel
cd ../intel
vercel link --project intel
vercel env pull
npm run dev  # Runs on http://localhost:3001

# Command
cd ../command
vercel link --project command
vercel env pull
npm run dev  # Runs on http://localhost:3002

# Keystone
cd ../keystone
vercel link --project keystone
vercel env pull
npm run dev  # Runs on http://localhost:3003

# Registry
cd ../registry
vercel link --project registry
vercel env pull
npm run dev  # Runs on http://localhost:3004

# Stacks
cd ../stacks
vercel link --project stacks
vercel env pull
npm run dev  # Runs on http://localhost:3005

# Sticks
cd ../sticks
vercel link --project sticks
vercel env pull
npm run dev  # Runs on http://localhost:3006
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
**Cause:** Vercel link failed or vercel env pull didn't run  
**Fix:**
```bash
vercel link --project hub --yes
vercel env pull
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
**Cause:** Monorepo linking not resolved  
**Fix:**
```bash
npm run build -w packages/ui
npm ci
npm run dev
```

### Error 5: "gcloud commands fail with BILLING_DISABLED"
**Symptom:** Any `gcloud scheduler` call fails, including a plain list  
**Cause:** Expected. Billing is disabled on `brickston-v2`. The Cloud Scheduler API is dead  
**Fix:** There is nothing to fix. Whatever you were trying to reach moved to Fly. See [GCP Cloud Run](/docs/gcp-cloud-run).

## What's Next?

- Browse the **Architecture** guide to understand the 8-app family and data topology
- Read the **Hub** guide to learn the entry point interface and chat proxy
- Read **Intel** to understand data ingestion from the 27 registered sources
- Read **Command** for portfolio management workflows
- Open a pull request to verify your Git + Vercel setup end-to-end
