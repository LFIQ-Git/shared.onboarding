# Hub App Guide

Hub is the entry point to the LFIQ platform. It hosts the document index, Brick chat interface, and central navigation to all other LFIQ applications.

## What It Does

Hub is a unified gateway into the LFIQ ecosystem. New users land on Hub, authenticate through Cloudflare Access, and then navigate to specific apps (Intel for data, Command for portfolio management, etc.). Hub also hosts the Brick chat interface. Hub makes no model calls itself; every chat request is proxied to the Fly `brickston-backend`, which answers questions about properties, market data, and internal documents.

**Primary features:**
- Public splash page (unauthenticated)
- User authentication (Cloudflare Access, then the `items.auth_allowed_users` allowlist)
- Document index (Properties, deals, reports, market data)
- Brick chat (AI assistant)
- App navigation (links to Intel, Command, Keystone, Registry, Stacks, Sticks)
- User profile & settings

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://hub.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-hub` |
| **Local Dev** | http://localhost:3040 | Via `npm run dev` in `hub/` | Local machine |
| **Staging** | (none) | n/a | n/a |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 16 | React 19, App Router, built for Workers with `@opennextjs/cloudflare` |
| **Language** | TypeScript | Full type coverage |
| **Styling** | Tailwind CSS | Utility-first CSS |
| **Auth** | Cloudflare Access | Clerk was retired 2026-09-17. Middleware verifies the signed `Cf-Access-Jwt-Assertion`; authorization is the `items.auth_allowed_users` row |
| **Backend** | Fly `brickston-backend` | Python FastAPI |
| **Database** | Neon (read-only) | Portfolio schema, read access |
| **Chat Proxy** | `app/api/brick-chat/route.ts` proxying `brickston-backend` | The backend makes the model calls |
| **Deployment** | Cloudflare Workers | Workers Builds on push to main, root directory `hub` |

## Local Development

### Start the App

```bash
git clone https://github.com/LFIQ-Git/brick.hub.git
cd brick.hub/hub
npm run dev
# Runs on http://localhost:3040
```

### Open in Browser

Navigate to http://localhost:3000. You should see:
- **Unauthenticated state:** the public splash page at `/`
- **Local dev:** `next dev` leaves every page except `/admin` open, so no Access session is needed locally

### Hot Reload

Changes to `.tsx` and `.ts` files auto-reload. No manual restart needed.

## Environment Variables

| Variable | Required? | Default | Purpose |
|----------|-----------|---------|---------|
| `BRICK_AUTH_ENABLED` | Prod | `true` in `wrangler.jsonc` | Master auth switch. Unset or misspelt leaves auth on |
| `BRICK_AUTH_DISABLED` | No | n/a | Local dev only, ignored in production. Set `true` to bypass the Access gate |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | Prod | set in `wrangler.jsonc` | Used to verify the Access JWT |
| `BRICK_COCKPIT_BASE_URL` | Yes | `https://brickston-backend.fly.dev` in `wrangler.jsonc` | Backend API base. `BRICKSTON_BACKEND_URL` is the fallback name |
| `BRICKSTON_SCHEDULER_SECRET` | Yes | n/a | Shared secret forwarded as `X-Scheduler-Secret` on backend proxy calls |
| `ITEMS_HUB_DATABASE_URL` | Yes | n/a | Neon connection for the `items.auth_allowed_users` allowlist and `/status` |
| `GUEST_EMAIL` / `GUEST_PASSWORD` / `GUEST_COOKIE_SECRET` | No | `GUEST_EMAIL` is a var in `wrangler.jsonc` | Guest sign-in, which the middleware accepts on its own signed cookie |

Production secrets are Worker secrets. List the names with `npx wrangler secret list --name brick-hub` and set one with `npx wrangler secret put <NAME> --name brick-hub`. Non-secret values are `vars` in `hub/wrangler.jsonc`.

## Key Flows

### Flow 1: User Authentication
1. User visits hub.lfiq.app
2. Cloudflare Access intercepts the request and sends the user to the `lfiq.cloudflareaccess.com` login page
3. After login, Access forwards the request with a signed `Cf-Access-Jwt-Assertion` header
4. Hub middleware verifies that JWT. A failure returns 401 on `/api/*` and redirects pages to `/login`
5. The `/login` page and `lib/brick-access.ts` check the user's row in `items.auth_allowed_users`. Clearing Access proves identity, not access to Hub

Sign-out is the `/cdn-cgi/access/logout` link.

### Flow 2: Brick Chat Request
1. User opens chat panel on right sidebar
2. User types a question (e.g., "Show me vacancy rates for 123 Main")
3. Hub frontend sends POST to `/api/brick-chat`
4. The route builds a clean header set (it does not replay browser headers) and forwards `X-Scheduler-Secret` plus `X-Brick-Operator-Email` to `/v1/ai/chat` on `brickston-backend`
5. The backend calls the model with prompt + context
6. Claude responds with text (or images)
7. Response streamed back to frontend, displayed in chat UI

### Flow 3: Navigation to Other Apps
1. User clicks "Go to Intel" in the navigation menu
2. User is redirected to intel.lfiq.app
3. Intel sits behind its own Cloudflare Access application, which reuses the team login
4. Intel checks the same `items.auth_allowed_users` row for the `intel` app grant
5. User lands on Intel inbox

## Troubleshooting

### Issue 1: "Every page redirects to /login, or /api returns 401"
**Symptom:** Signed in through Access but Hub keeps bouncing you  
**Cause:** The Access JWT failed verification, usually a `CF_ACCESS_AUD` that does not match the Access application  
**Fix:**
```bash
# Look for access_gate_rejected events and their reason
npx wrangler tail brick-hub
```

### Issue 2: "Signed in but told you have no access"
**Symptom:** Access login succeeds but Hub refuses you  
**Cause:** No `items.auth_allowed_users` row for your email, or the row lacks the app  
**Fix:**
```bash
# Access is granted through Command /admin/users, not in the Access dashboard

```

### Issue 3: "Chat button shows 'Error' state"
**Symptom:** Brick chat panel shows red error icon  
**Cause:** `brickston-backend` is down, or the scheduler secret drifted between Hub and the backend  
**Fix:**
```bash
# Check the backend on Fly
flyctl status --app brickston-backend
flyctl logs --app brickston-backend

# Confirm the secret name is set on the Worker
npx wrangler secret list --name brick-hub

# Clear browser cache and retry
# DevTools > Application > Clear Site Data
```

### Issue 4: "Neon connection timeout on document list"
**Symptom:** Document index takes 40+ seconds to load  
**Cause:** Neon cold start  
**Fix:**
```bash
# Warm Neon connection
psql "$ITEMS_HUB_DATABASE_URL" -c "SELECT 1;"

# Then reload page in browser
```

### Issue 5: "401 or 403 when calling /api/brick-chat"
**Symptom:** The chat request fails with an auth error even though you are signed in  
**Cause:** A 403 from Hub means your allowlist row does not permit Brick chat. A 401 from the backend means the scheduler secret does not match  
**Fix:**
```bash
# Confirm the secret matches on both sides
flyctl secrets list --app brickston-backend | grep -i scheduler
npx wrangler secret list --name brick-hub
# Rotate both together if they drifted

flyctl logs --app brickston-backend
```

## Common Tasks

### Task 1: Change Brick Chat Behavior
Hub sends the message with `persona: "brick"` and holds no system prompt. Prompt changes are made in `brickston-backend`, not in Hub.

### Task 2: Add a New Navigation Link
The app launcher list is `hub/lib/apps.ts`. Each entry carries the app's `url`. Add the new app there and restart `npm run dev`.

## Deployment & CI/CD

### Automatic Deployment (Workers Builds)

Every push to main is built and deployed by Cloudflare Workers Builds, with the root directory set to `hub`. The settings of record are in `hub/docs/cloudflare-workers-builds.md`.

Check deployment status:
```bash
npx wrangler deployments list --name brick-hub
```

The Worker sets `preview_urls: false`, so there are no per-branch preview hosts.

### Manual Deploy (Emergency)

If the Workers Builds deploy fails:
```bash
cd hub
npm run deploy:cloudflare
```

## Logs & Monitoring

### View Worker Logs
```bash
npx wrangler tail brick-hub
# Streams live logs from the production Worker
```

Access login events are in the Cloudflare Zero Trust dashboard.

### View Backend Logs (Chat)
```bash
flyctl logs --app brickston-backend
```

## Related Documentation

- **Getting Started:** Setup, Logins, Install Tools
- **Architecture:** System topology, auth model, deployment
- [Cloudflare Access](/docs/access-auth)
- [Fly.io Backend](/docs/fly-io-backend)
- **Next.js:** https://nextjs.org/docs
