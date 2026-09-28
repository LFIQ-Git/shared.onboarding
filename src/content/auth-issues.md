# Authentication Issues

Cloudflare Access fronts every BRICK app, `items.auth_allowed_users` decides who may open what, and a set of shared secrets gates machine-to-machine calls. Clerk is retired; `clerk.lfiq.app` no longer resolves. Most auth failures here are middleware wired wrong, an empty or mismatched secret, or a user with no allowlist row.

## Triage table

| What you see | Go to |
|--------------|-------|
| A page 401s or redirects to `/login` even though Access let you through | [Middleware pitfalls](#middleware-pitfalls) |
| Middleware runs on assets it should skip, or skips paths it should gate | [Middleware pitfalls](#middleware-pitfalls) |
| The app build fails because middleware pulls in `postgres` | [Middleware pitfalls](#middleware-pitfalls) |
| You clear Access and the app says "Access not enabled" | [Access model](#access-model) |
| The app says it "Can't check your access right now" | [Access model](#access-model) |
| A signed-out request gets a 302 to `lfiq.cloudflareaccess.com` | [Sign-in flow](#sign-in-flow) |
| Local pages redirect to `/login` and you have no session | [Local development bypass](#local-development-bypass) |
| Local API routes return 401 while pages load | [Local development bypass](#local-development-bypass) |
| A machine call returns 401, 403, or 503 | [Service-to-service auth](#service-to-service-auth) |
| An MCP client returns 401, 404, 405, or 500 | [Service-to-service auth](#service-to-service-auth) |

## Middleware pitfalls

### Symptom: Access lets you through but the app 401s or redirects to `/login`

**Cause:** the gate verifies the signed `Cf-Access-Jwt-Assertion` header against `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. A wrong or missing `CF_ACCESS_AUD` for that hostname, or a request that reached the Worker without passing through Access, fails verification. The gate logs `access_jwt_rejected` or `access_gate_rejected` with a reason.

**Fix:** confirm the `CF_ACCESS_AUD` var in the app's wrangler config matches the Access application for that hostname. The AUD also appears as the `kid` parameter on the Access login redirect for that host.

**How to confirm it worked:** `npx wrangler tail <worker>` shows no rejection log for your request, and the page renders.

### Symptom: the build fails once middleware imports the allowlist code

**Cause:** middleware runs in the Edge runtime. Anything that imports the `postgres` client cannot be bundled there.

**Fix:** keep middleware limited to JWT verification. Import the header constant from `lib/access-header.ts`, not from the module that queries the table, and do the `items.auth_allowed_users` lookup on the `/login` page or in a server helper.

**How to confirm it worked:** `npm run build` succeeds and the middleware bundle carries no `postgres` import.

### Symptom: the matcher is ignored, or the build behaves as if `config` were absent

**Cause:** `export const config = BRICK_MIDDLEWARE_CONFIG` with the value imported from `@brick/middleware`. Next.js statically analyzes middleware config at build time and cannot resolve imported symbols.

**Fix:** inline the matcher as an object literal in every sub-app's `middleware.ts`. The shared constant is exported for reference only.
```ts
import { createBrickAccessGate } from "@brick/middleware";
const accessGate = createBrickAccessGate("repair");   // app key varies per sub-app

export default function middleware(req, event) {
  const disabled =
    process.env.BRICK_AUTH_DISABLED === "1" ||
    process.env.BRICK_AUTH_DISABLED === "true" ||
    process.env.BRICK_AUTH_ENABLED === "false";
  if (disabled || process.env.NODE_ENV === "development") return NextResponse.next();
  return accessGate(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon\\.png|icon\\.svg).*)"],
};
```

**How to confirm it worked:** a static asset in the exclusion list loads without a redirect, and a gated page still redirects when signed out.

### Symptom: `manifest.webmanifest` or `icon.svg` returns HTML, and Chrome reports manifest icon errors

**Cause:** the middleware matcher does not exclude those paths, so a request without a valid Access assertion gets a redirect to `/login` and the browser receives a login page where it expected an asset. Keystone hit this on both the manifest and the icon.

**Fix:** add the paths to the matcher's negative lookahead and to any public-passthrough helper. Point `manifest.ts` icons at a file that exists, for example `app/icon.svg` with `type: "image/svg+xml"` and `sizes: "any"`.

**How to confirm it worked:** loading `/icon.svg` in a browser session that has cleared Access returns an image, not HTML. A signed-out `curl` gets Access's own 302 before the Worker sees the request, so it cannot test this.

### Where each app's gate lives

| App | Gate file |
|-----|-----------|
| Command sub-apps | each `apps/<name>/middleware.ts` calling `createBrickAccessGate` from `packages/brick-middleware` |
| Hub | `hub/middleware.ts`, plus the allowlist lookup in `hub/lib/auth-access.ts` and `hub/lib/brick-access.ts` |
| Registry | `middleware.ts` at repo root |

Command and Registry treat `/api(.*)` as public in middleware and enforce in-route. Hub does not: only `/api/guest-login` and `/api/guest-logout` are public, so any new Hub API endpoint that must be reachable without an Access assertion needs an explicit entry in `PUBLIC_PATTERNS` in `hub/middleware.ts` or it returns 401.

## Sign-in flow

### Symptom: a signed-out request gets a 302 to `lfiq.cloudflareaccess.com`

**Cause:** expected. Access intercepts every unauthenticated request before it reaches the Worker and redirects to `https://lfiq.cloudflareaccess.com/cdn-cgi/access/login/<host>`. The login page offers Google, Microsoft Entra ID and an emailed one-time code.

**Fix:** none needed. Sign in there. Each hostname has its own Access application, so a new app may ask again.

**How to confirm it worked:** after sign-in you land on the app, or on its `/login` notice if you have no allowlist row.

## Access model

Access proves identity. The row in `items.auth_allowed_users` grants apps.

| Setting | Value |
|---------|-------|
| Identity providers | Google, Microsoft Entra ID, emailed one-time code |
| Grant of record | `items.auth_allowed_users` (`apps[]`, `is_admin`) |
| Key | Email address, lowercased |

### Symptom: you clear Access but the app says "Access not enabled"

**Cause:** your address has no row, or the row's `apps[]` does not include this app. Hub admits anyone with a row.

**Fix:** a user with `is_admin` adds or edits the row at Command `/admin/users`, or an agent calls Command `/api/machine/users` with `X-Brick-Machine-Secret`. There is no invite step; the change is live on the next request.

| App role | Default apps | Admin |
|----------|--------------|-------|
| `brick_admin` | Hub, Command, Intel, Keystone, Registry, Sticks, Stacks, Back9 | Yes |
| `command_user` | Command, Registry, Sticks, Stacks | No |

**How to confirm it worked:** reload the app. The notice is gone.

### Symptom: the app says it "Can't check your access right now"

**Cause:** the allowlist lookup threw, usually a missing or wrong `ITEMS_HUB_DATABASE_URL` or a Neon outage. The apps report this separately so an outage does not read as a permissions problem.

**Fix:** check the Worker's secret names with `npx wrangler secret list --name <worker>` and the Neon endpoint status. See [Neon Debugging](/docs/neon-debugging).

**How to confirm it worked:** the same page resolves your access after a reload.

## Local development bypass

### Symptom: local pages redirect to `/login` and you cannot render a gated view

**Cause:** no Access application runs in front of localhost, so there is no signed assertion to verify.

**Fix:** disable the gate.
```bash
export BRICK_AUTH_DISABLED=true     # honored only when NODE_ENV != production
npm run dev
```
`isBrickAuthDisabled()` makes the apps resolve a synthetic operator with every app unlocked.

**How to confirm it worked:** the gated page renders with all cards unlocked instead of redirecting.

### Symptom: local API routes return 401 even though the app loads

**Cause:** an `.env.local` that sets `BRICK_AUTH_ENABLED="true"`. An explicit true wins over `BRICK_AUTH_DISABLED`, and localhost carries no Access assertion, so the APIs reject you. The local Stacks `.env.local` has been seen this way.

**Fix:** flip `BRICK_AUTH_ENABLED` to `"false"` locally.

**Known follow-on:** with auth off, the Stacks app-wide RSC stream may not hydrate in a headless preview, leaving main content stuck in a streaming placeholder on every page. Verify client interactivity on the deployed app with a real Access session rather than fighting the local render.

**How to confirm it worked:** the API route returns 200 locally.

## Service-to-service auth

Several shared secrets gate machine calls between apps. The failure codes tell you which one.

| Caller and target | Header | Environment variable | Failure |
|-------------------|--------|----------------------|---------|
| Any caller to Command `/api/refresh` | `X-Refresh-Secret` (also accepts `X-Scheduler-Secret`) | `COMMAND_REFRESH_SECRET` | 401 on wrong or missing |
| Command web to the backend `/api/v1/items-hub/*` | `X-Scheduler-Secret` | `BRICKSTON_SCHEDULER_SECRET` on the caller, `SCHEDULER_SECRET` on the backend | 401 mismatch, 503 unset on the backend |
| Backend producer to Intel ingest | `x-ingest-secret` | `BRICKSTON_ITEMS_HUB_INGEST_SECRET` and Intel's `INGEST_SECRET` | 403 rejected |

### Symptom: 503 with `SCHEDULER_SECRET not configured on brickston-backend`

**Cause:** the backend is running in production mode without `SCHEDULER_SECRET` set. The dependency raises 503 specifically so it is not confused with a generic server error.

**Fix:** set `SCHEDULER_SECRET` on the backend and make the caller's `BRICKSTON_SCHEDULER_SECRET` match byte for byte. Command production is the canonical copy of the value.

**How to confirm it worked:** the same call returns 200. A 401 instead of 503 means the secret is now set but does not match.

### Symptom: an ingest POST returns 403

**Cause:** the ingest token is a single shared symmetric value, with Intel as the verifier and the backend as the producer. `assertIngestAuth` compares against one value with no comma list and no grace period, so any rotation opens a window where one side is ahead.

**Fix:** set both sides back to back. Both names are Worker secrets on `brick-intel` and `BRICKSTON_ITEMS_HUB_INGEST_SECRET` is a Fly secret on `brickston-backend`.
```sh
NEW=$(openssl rand -hex 32)

cd brick.intel
printf %s "$NEW" | npx wrangler secret put INGEST_SECRET --name brick-intel
printf %s "$NEW" | npx wrangler secret put BRICKSTON_ITEMS_HUB_INGEST_SECRET --name brick-intel

fly secrets set BRICKSTON_ITEMS_HUB_INGEST_SECRET="$NEW" -a brickston-backend
```

**How to confirm it worked:**
```sh
curl -so /dev/null -w '%{http_code}\n' -X POST https://intel.lfiq.app/api/ingest/entity-tags \
  -H "x-ingest-secret: $TOKEN" -H 'content-type: application/json' -d '{}'
```
403 means the token was rejected. 400 means the token was accepted and the empty body was rejected, which is the success signal.

`intel.lfiq.app` is fronted by Cloudflare Access on every path, including `/api`. A request with no Access credentials gets Access's 302 to `lfiq.cloudflareaccess.com` before the Worker sees it, so this check only reaches `assertIngestAuth` when it also carries Access service-token headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`).

Never probe a secret with `${VAR:+SET}${VAR:-MISSING}`. That expands both branches and prints the value. Use `${VAR:+SET}` alone.

### Symptom: a call that looks authenticated in the browser still fails against the backend

**Cause:** a browser session is not a machine credential. The Brick chat proxy routes strip the inbound `Authorization` header on purpose, because a session JWT is not a valid platform bearer token, and then attach the machine credentials plus `X-Brick-Operator-Email`. If the proxy skips that step, the backend sees an anonymous request.

**Fix:** in any new proxy route, remove the inbound `Authorization`, attach the scheduler secret, and forward the operator email. The metrics endpoints on the backend depend on the operator email being present.

**Not verified, confirm with Justin:** these proxy routes also carry an ID-token path minted from `BRICKSTON_CLOUD_RUN_INVOKER_SA_JSON`. That variable name is a legacy identifier; `brickston-backend` runs on Fly, and whether the ID-token branch is still required is unresolved. Do not delete it based on this page alone.

### Symptom: the Keystone MCP token endpoint returns 500 `OAuth not configured on this server`, or a client gets a 405 Method Not Allowed

**Cause:** a redeploy of the Fly app `pkm-mcp` dropped secrets that do not carry over automatically. Missing OAuth credentials produce the 500. A missing public URL is subtler: the app reads the request scheme, which is plain HTTP behind the TLS edge, so the discovery document advertises an `http://` token URL. The client posts to it, gets a 301, the HTTP library downgrades POST to GET, and the result is a 405 that hides the real problem.

**Fix:**
```sh
flyctl secrets set \
  PKM_MCP_OAUTH_CLIENT_ID=... \
  PKM_MCP_OAUTH_CLIENT_SECRET=... \
  PKM_MCP_PUBLIC_URL=https://keystone-mcp.lfiq.app \
  -a pkm-mcp
```
The matching client credentials live in the local menubar config file, which is the source of truth for what the server must equal. Do not copy values from the archived Fly config artifact in the Hub repo; it points at the wrong app.

**How to confirm it worked:** the discovery document advertises `https://`, and a client-credentials POST to `/oauth/token` returns 200 with an access token.

### Symptom: an MCP client reports 401 or a connection failure

**Cause:** stale client configuration pointing at a retired endpoint. `brick-mcp-server` moved to Fly on 2026-08-06. The old URL returns a plain 404 because the service is gone, not because you are unauthenticated.

**Fix:** point clients at the current hosts.

| Server | Current URL |
|--------|-------------|
| Brick MCP | `https://brick-mcp.lfiq.app/mcp` |
| Keystone MCP | `https://keystone-mcp.lfiq.app/mcp` |

Check `~/.cursor/mcp.json` and the Claude Code global config. A stdio entry that shells into a local Docker container is stale; the local container fleet is retired. Restart the client after editing a global config.

**How to confirm it worked:** a POST to the Brick MCP URL with the bearer token returns 200. A request to the Keystone MCP URL returning 400 `Missing session ID` is expected protocol behavior without an `initialize` handshake first, not an auth failure.

## Related pages

- [Common Errors](/docs/common-errors)
- [Cloudflare Access](/docs/access-auth)
- [Cloudflare Debugging](/docs/cloudflare-debugging)
- [Logins and Auth](/docs/getting-started/logins)
- [Architecture](/docs/architecture)
