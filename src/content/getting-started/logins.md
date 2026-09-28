# Getting Started: Logins & Authentication

Complete reference for the authentication systems used across LFIQ applications: Cloudflare Access, the operator allowlist, database roles, and API credentials.

## Cloudflare Access (BRICK Apps)

Cloudflare Access fronts Hub, Intel, Command and its sub-apps, Keystone, Registry, Stacks and Sticks. Access proves who you are; your row in `items.auth_allowed_users` decides which apps you may open. Full depth is on [Cloudflare Access](/docs/access-auth).

Clerk is retired across the fleet (cutover to Access on 2026-09-13, last Clerk code removed from Hub on 2026-09-17), and Sticks no longer runs NextAuth. If you find `CLERK_*`, `BRICK_CLERK_*` or `NEXTAUTH_*` referenced in one of those repos, treat it as dead configuration.

### Logging In

**Supported Methods** (read from the live Access login page):
- Google
- Microsoft Entra ID
- Emailed one-time code

**Login Flow:**
1. Visit any BRICK app (hub.lfiq.app, intel.lfiq.app, etc.)
2. Access redirects you to `lfiq.cloudflareaccess.com`
3. Choose Google, Microsoft, or request a one-time code
4. Authenticate
5. Access redirects you back to the app with an Access session cookie

Each Access application covers one hostname, so the first visit to a new app may send you through the Access page again.

**Troubleshooting Login:**
- **Access denies you before you reach the app:** the Access policy does not admit your address. Ask a `brick_admin`
- **You clear Access but the app says access is not enabled:** your email has no row in `items.auth_allowed_users`, or the row does not list that app
- **The app says it cannot check your access right now:** the allowlist lookup failed. That is an outage, not a permissions problem

### Access Model

| App role | Default apps | Admin |
|----------|--------------|-------|
| `brick_admin` | Hub, Command, Intel, Keystone, Registry, Sticks, Stacks, Back9 | Yes |
| `command_user` | Command, Registry, Sticks, Stacks | No |

`items.auth_allowed_users` is the grant of record. Adding a row there is the whole grant, and it takes effect on the person's next request.

**Two ways to add a user:** Command `/admin/users` (your row must have `is_admin`), or Command's machine route `/api/machine/users` with `BRICK_MACHINE_ADMIN_SECRET`.

### Auth Environment Variables (for Developers)

```bash
CF_ACCESS_TEAM_DOMAIN=     # "lfiq"; shipped as a wrangler var in production
CF_ACCESS_AUD=             # per-hostname audience tag; shipped as a wrangler var
ITEMS_HUB_DATABASE_URL=    # Neon DSN holding items.auth_allowed_users
BRICK_AUTH_DISABLED=       # local dev only
```

Locally there is no Access application in front of the app. Set `BRICK_AUTH_DISABLED=true` to run without the gate; it is ignored in production.

## Neon Database Authentication

Direct database access uses Neon roles and connection strings. Each app connects with a least-privilege role.

### Connection Strings

**Base endpoint:** `ep-tiny-lab-akrddwgy.us-west-2.aws.neon.tech`

**Format:**
```
postgresql://ROLE:PASSWORD@ep-tiny-lab-akrddwgy.us-west-2.aws.neon.tech/neondb?sslmode=require
```

### Database Roles (Least Privilege)

| Role | Apps | Allowed Schemas | Notes |
|------|------|-----------------|-------|
| `intel` | Intel | items, market, portfolio (read) | Ingest |
| `command` | Command, brickston-backend | portfolio, collect, repair, gdm (read), market (read) | CRUD operations |
| `pkm` | Keystone | public | Daily briefing, tasks |
| `gdm_extractor` | GDM extract job | gdm | Golden Data Model sync |
| `market_scraper` | Market scrape jobs | market | Rent trends, comps |
| `neondb_owner` | Migrations only | * | DDL and RLS policies, never an app runtime role |

Grants alone are not always enough. Several tables have Row-Level Security enabled, and a role without a policy sees zero rows with no error. Add policies as `neondb_owner`, not through the app-role migration runner.

### Getting a Connection String

Pull the DSN from the Neon console (project `morning-fire-74787570`, **Connect**) and put it in your local `.env.local`. It returns the pooled string; remove `-pooler` from the host for the direct string. Deployed Workers hold it as a secret; `npx wrangler secret list --name <worker>` confirms the name is set but never shows the value.

Use the pooled `DATABASE_URL` at runtime. `DATABASE_URL_UNPOOLED` is for migration tooling only, and in at least one project it is stored wrapped in literal quotes, so code that reads it has to strip them.

### Local Database Access

Connect directly to Neon with `psql`. There is no proxy step.

```bash
psql "$DATABASE_URL" -c "SELECT * FROM portfolio.properties LIMIT 5;"
```

**Port:** 5432 (Neon standard)  
**SSL Mode:** Required (always use `sslmode=require`)  
**Schema:** The Neon console defaults to `public`. Switch the dropdown or qualify the table, or the data will look missing.

## Google and Microsoft Sign-In (Access Identity Providers)

Google and Microsoft Entra ID are configured as identity providers on the Cloudflare Access team `lfiq`, not in any app. Part of the organization is on Microsoft 365 rather than Google Workspace, which is why both exist. The emailed one-time code is the fallback for an address on neither.

### Troubleshooting

- **The provider rejects the sign-in:** the identity provider configuration in Cloudflare Zero Trust drifted; contact the platform team
- **Access says you are not authorized:** the Access policy does not admit your address
- **"Scope not granted":** you declined permission; sign in again and grant it

## GitHub CLI Authentication

GitHub CLI (`gh`) is used for cloning private repos, opening pull requests, and checking CI status.

### Initial Setup

```bash
gh auth login
# Follow prompts:
# ? What is your preferred protocol for Git operations? [HTTPS/SSH] → Choose HTTPS
# ? How would you like to authenticate GitHub CLI? [Login with a browser/Paste an authentication token] → Login with browser
# ? Open user authorization in your browser? [Y/n] → Y
# (browser opens, show device code, authorize)
```

### Verify Authentication

```bash
gh auth status
# Expected output:
# github.com
#   ✓ Logged in to github.com as YourGitHubUsername
#   ✓ Git operations protocol: https
#   ✓ Token: ghu_***
#   ✓ Token scopes: repo, read:org, gist
```

### Token Storage

GitHub CLI automatically stores your token in macOS Keychain:
```
Keychain account: github.com
Service: gh
```

### Troubleshooting GitHub CLI

- **"Not authorized":** Run `gh auth login` again
- **"Wrong GitHub account":** Logout and log back in:
  ```bash
  gh auth logout
  gh auth login
  ```
- **Token expired:** Re-authenticate:
  ```bash
  gh auth refresh
  ```

## Fly.io Authentication

Fly.io hosts `brickston-backend` (the Command API), `brick-cron` (the batch-job dispatcher), `brick-mcp-server`, and `pkm-mcp`. Authentication is via API token.

### Setup Flyctl

```bash
flyctl auth login
# Browser opens, log in with your Fly.io account
# Token is stored in ~/.fly/credentials.yml
```

### Verify Flyctl Authentication

```bash
flyctl auth whoami
# Expected output: your-email@example.com
```

### Common Flyctl Commands

```bash
# View app status
flyctl status --app=brickston-backend

# View logs
flyctl logs --app=brickston-backend

# Deploy (requires git push first, and a running Docker daemon)
colima start
flyctl deploy --app brickston-backend --local-only

# SSH into running instance
flyctl ssh console --app brickston-backend

# Run a batch job by its crontab label
flyctl ssh console -a brick-cron -C "/app/run-job.sh <label>"
```

When an app runs more than one machine, `flyctl ssh sftp put` and `flyctl ssh console` can land on different machines, so an uploaded file appears to vanish. Pass the script inline instead of uploading it.

### Troubleshooting Fly.io

- **"Not authenticated":** Run `flyctl auth login` again
- **"Permission denied":** You don't have access to the brickston-backend app; contact platform team
- **"Failed to deploy":** Check build logs:
  ```bash
  flyctl logs --app=brickston-backend --follow
  ```

## Anthropic API

Intel, Keystone and the Command backend call the Anthropic API. Hub does not; its Brick chat is proxied to the Command backend.

### API Key

On the Workers the key name is `ANTHROPIC_API_KEY` (set as a Worker secret on `brick-intel` and `brick-keystone`). On the `brickston-backend` Fly app it is `BRICKSTON_AI_ANTHROPIC_API_KEY`.

```bash
npx wrangler secret list --name brick-intel     # names only
flyctl secrets list -a brickston-backend        # names only
```

### Usage

- **Hub chat proxy**: forwards user messages to the Command backend, which calls Claude
- **Keystone embeddings**: generates embeddings for RAG (Retrieval-Augmented Generation)
- **Intel insights**: Claude analysis on observations and properties

### Rate Limits & Quotas

Rate limits and the spend cap are whatever is set on the account in the Anthropic console. Check there rather than assuming a tier.

### Troubleshooting Anthropic API

- **"Invalid API key":** Key rotated. Update the Worker secret with `npx wrangler secret put ANTHROPIC_API_KEY --name <worker>`, and the Fly secret too if the backend is affected
- **"Rate limit exceeded":** Too many concurrent requests; add exponential backoff
- **"Quota exceeded":** Spend limit hit; check the Anthropic console

## Summary: Which Credentials Do I Need?

| Role | GitHub CLI | Cloudflare (wrangler) | Access + allowlist row | Fly.io | Neon |
|------|-----------|--------|-------|--------|-----|
| Developer (Frontend) | ✓ | ✓ | ✓ (as a user) | ✗ | ✓ |
| Developer (Backend) | ✓ | ✓ | ✓ (as a user) | ✓ | ✓ |
| DevOps / Platform | ✓ | ✓ (admin) | ✓ (`is_admin`) | ✓ | ✓ |
| Product Manager | ✓ | ✗ | ✓ (as a user) | ✗ | ✗ |

## Next Steps

- Complete **Setup** to clone the app repos and install all tools
- Read each **App Guide** (Hub, Intel, Command, etc.) for app-specific auth flows
- See [Auth Issues](/docs/auth-issues) for common authentication failures across all apps
