# Authentication Issues

The fleet runs on one shared Clerk instance, `clerk.lfiq.app`, plus a set of shared secrets for machine-to-machine calls. Almost every auth failure here is one of four things: middleware wired wrong, the wrong Clerk hook, an empty secret, or a user who was never provisioned in Clerk.

## Triage table

| What you see | Go to |
|--------------|-------|
| `auth() was called but Clerk can't detect usage of clerkMiddleware()` | [Middleware pitfalls](#middleware-pitfalls) |
| Middleware breaks only in production, works in dev | [Middleware pitfalls](#middleware-pitfalls) |
| Middleware runs on assets it should skip, or skips paths it should gate | [Middleware pitfalls](#middleware-pitfalls) |
| `signIn.authenticateWithRedirect is not a function`, or `isLoaded` is undefined | [Sign-in flow](#sign-in-flow) |
| The sign-in card shows a "Development mode" badge | [Sign-in flow](#sign-in-flow) |
| A user has a Google account but cannot sign in | [Access model](#access-model) |
| You added a database row and access still does not work | [Access model](#access-model) |
| Every path returns 404 to a signed-out client | [Access model](#access-model) |
| Local pages redirect to `/login` and you have no session | [Local development bypass](#local-development-bypass) |
| Local API routes return 401 against a real Clerk key | [Local development bypass](#local-development-bypass) |
| A machine call returns 401, 403, or 503 | [Service-to-service auth](#service-to-service-auth) |
| An MCP client returns 401, 404, 405, or 500 | [Service-to-service auth](#service-to-service-auth) |

## Middleware pitfalls

### Symptom: a 500 with `auth() was called but Clerk can't detect usage of clerkMiddleware()`

**Cause:** something bypassed `clerkMiddleware` entirely in the outer middleware function instead of short-circuiting inside its callback. A full bypass leaves Clerk's request context unset, so any `auth()` call or `<ClerkProvider>` during a server render throws. The guest-login bypass caused this on Hub, whose root layout wraps `ClerkProvider`. Command and Registry survived a full bypass only because their layouts do not wrap it, which made the bug look app-specific when it was not.

**Fix:** run the bypass check inside the `clerkMiddleware` callback and return early there rather than skipping the wrapper.
```ts
export default clerkMiddleware(async (auth, req) => {
  if (await isGuestRequest(req)) return;   // inside the callback
  await auth.protect();
});
```

**How to confirm it worked:** with a guest cookie set, Hub, Command, and Registry all return 200. With no cookie, Hub and Registry return a 307 to `/login`.

### Symptom: middleware works locally but fails on Vercel Edge

**Cause:** Clerk keys passed explicitly as module-level options to `clerkMiddleware`. Clerk auto-detects `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the environment. Passing them as module-level options breaks in the Edge Runtime.

**Fix:** set the environment variables and let Clerk read them. Do not construct the middleware with an options object built at module scope.

**How to confirm it worked:** the middleware runs on a preview deployment without a runtime error, and a signed-in request reaches the page.

### Symptom: the matcher is ignored, or the build behaves as if `config` were absent

**Cause:** `export const config = BRICK_MIDDLEWARE_CONFIG` with the value imported from `@brick/middleware`. Next.js statically analyzes middleware config at build time and cannot resolve imported symbols.

**Fix:** inline the matcher as an object literal in every sub-app's `middleware.ts`. The shared constant is exported for reference only.
```ts
import { createBrickClerkGate } from "@brick/middleware";
const clerkGate = createBrickClerkGate("repair");   // app key varies per sub-app

export default function middleware(req, event) {
  const disabled =
    process.env.BRICK_AUTH_DISABLED === "1" ||
    process.env.BRICK_AUTH_ENABLED === "false";
  if (disabled || process.env.NODE_ENV === "development") return NextResponse.next();
  return clerkGate(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon\\.png|icon\\.svg).*)"],
};
```

**How to confirm it worked:** a static asset in the exclusion list loads without a redirect, and a gated page still redirects when signed out.

### Symptom: `manifest.webmanifest` or `icon.svg` returns HTML, and Chrome reports manifest icon errors

**Cause:** the middleware matcher does not exclude those paths, so unauthenticated requests get a 302 to `/login` and the browser receives a login page where it expected an asset. Keystone hit this on both the manifest and the icon.

**Fix:** add the paths to the matcher's negative lookahead and to any public-passthrough helper. Point `manifest.ts` icons at a file that exists, for example `app/icon.svg` with `type: "image/svg+xml"` and `sizes: "any"`.

**How to confirm it worked:** `curl -sI https://<app>.lfiq.app/icon.svg` returns 200 with an image content type, signed out.

### Where each app's gate lives

| App | Gate file |
|-----|-----------|
| Command sub-apps | each `apps/<name>/middleware.ts` calling `createBrickClerkGate` from `packages/brick-middleware` |
| Hub | `hub/proxy.ts`, re-exported, plus server-side re-gating in `hub/lib/brick-access.ts` |
| Registry | `middleware.ts` at repo root |

Command and Registry treat `/api(.*)` as public in middleware and enforce in-route. Hub does not, so any new Hub API endpoint that must be reachable without a Clerk session needs an explicit whitelist in `proxy.ts` or it returns 401.

## Sign-in flow

### Symptom: custom OAuth buttons throw because `signIn.authenticateWithRedirect` does not exist and there is no `isLoaded`

**Cause:** Clerk v7's default `import { useSignIn } from "@clerk/nextjs"` returns the new signals API, which exposes `{ errors, fetchStatus, signIn }` with `signIn.sso(...)`. The classic hook lives at a different import path.

**Fix:**
```ts
import { useSignIn } from "@clerk/nextjs/legacy";

const { isLoaded, signIn, setActive } = useSignIn();
await signIn.authenticateWithRedirect({
  strategy: "oauth_google",
  redirectUrl: "/login/sso-callback",
  redirectUrlComplete: "/",
});
```
The legacy hook is the documented pattern for custom buttons and finalizes on the existing `/login/sso-callback` route. Custom buttons also avoid the hosted card's email field and the "Secured by Clerk" footer.

**How to confirm it worked:** clicking the Google button redirects to Clerk, returns to `/login/sso-callback`, and lands signed in.

### Symptom: local sign-in shows a "Development mode" badge and only offers Google

**Cause:** Hub's `.env.local` carries a `pk_test_` publishable key that points at a throwaway development Clerk instance, not production. The `pk_live_` key exists only in Vercel environment variables.

**Fix:** this is expected locally. To read what an instance actually has enabled, decode the key's domain and query the live environment endpoint.
```bash
echo "<base64-after-pk_test_-or-pk_live_>" | base64 -d

curl -s "https://clerk.lfiq.app/v1/environment?__clerk_api_version=2021-02-05&_clerk_js_version=5.0.0" \
  -H "Origin: https://hub.lfiq.app" \
| python3 -m json.tool | grep -A20 user_settings
```

**How to confirm it worked:** the response shows `oauth_google` and `oauth_microsoft` enabled, password disabled, and sign-up mode restricted.

## Access model

The shared instance is social-login-only. There are no passwords anywhere in the fleet.

| Setting | Value |
|---------|-------|
| Enabled first factors | Google (`oauth_google`), Microsoft (`oauth_microsoft`) |
| Disabled | password, passkey, email code, email link |
| Sign-up mode | restricted, invite and allowlist gated |
| Domain allowlist | `*@lfiq.app`, `*@leftfieldinv.com`, `*@mosserco.com` |

Both providers are required because the organization is split between Google Workspace on `lfiq.app` and Microsoft 365 on `leftfieldinv.com` and `mosserco.com`. A Google-only configuration would lock out the Mosser users.

The allowlist is disabled on sign-in, so it gates sign-ups only. Existing users always sign in regardless of domain.

### Symptom: a user with a valid Google or Microsoft account cannot get in

**Cause:** they were never provisioned. Sign-up is restricted, so self-service does not exist.

**Fix:** add them through Clerk, which is the single source of truth.
1. Hub `/admin/users`, "Add or update user". You must be `brick_admin`. One action creates the Clerk user, adds org membership with a role, and upserts the database projection row.
2. Or Clerk Dashboard, BRICK org, Invite Member, choosing `org:admin` or `org:member`.

| App role | Clerk org role | Grants |
|----------|----------------|--------|
| `brick_admin` | `org:admin` | Hub, Registry, Intel, Command, Keystone, plus admin |
| `command_user` | `org:member` | Command only |

**How to confirm it worked:** the user appears in Clerk with the intended org role, and their `sessionClaims.apps` passes `createBrickClerkGate` for the app they need.

### Symptom: you inserted a row into `items.auth_allowed_users` and access still does not work

**Cause:** that table is a read-only projection, refreshed from Clerk on every `/admin/users` load. It gates nothing. The old database-lookup gating was retired when the fleet moved to Clerk.

**Fix:** grant access in Clerk. The database row will sync on the next `/admin/users` load.

**How to confirm it worked:** the row's role matches Clerk after a page load, and the user reaches the app.

### Symptom: an app returns 404 on every path to a signed-out client

**Cause:** a signed-out rewrite, not a broken deployment. Intel production does this. See the Vercel page for the header check.

**Fix:** confirm `x-clerk-auth-status: signed-out` before escalating.

**How to confirm it worked:** the same path serves content in a browser with a session.

## Local development bypass

### Symptom: local pages redirect to `/login` and you cannot render a gated view

**Cause:** no Clerk session locally. Clerk-gated pages redirect before rendering.

**Fix:** disable the gate and give `ClerkProvider` a well-formed dummy key.
```bash
export BRICK_AUTH_DISABLED=true                                  # honored only when NODE_ENV != production
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_<any-valid-format>"
export CLERK_SECRET_KEY="sk_test_<any>"
next dev --port 3040
```
`isBrickAuthDisabled()` makes `getCurrentBrickAccess()` return a synthetic user with every app unlocked. Client-side `useUser()` still returns null because there is no session, and the dummy key produces a harmless Clerk "unable to attribute request" console error. Ignore it.

**How to confirm it worked:** the gated page renders with all cards unlocked instead of redirecting.

### Symptom: local API routes return 401 even though the app loads

**Cause:** an `.env.local` that sets `BRICK_AUTH_ENABLED="true"` with production Clerk keys. There is no localhost session against a production instance, so the APIs reject you. Stacks ships this way.

**Fix:** flip `BRICK_AUTH_ENABLED` to `"false"` locally.

**Known follow-on:** with auth off, the Stacks app-wide RSC stream may not hydrate in a headless preview, leaving main content stuck in a streaming placeholder on every page. Verify client interactivity on a Vercel preview with a real session rather than fighting the local render.

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

**Fix:** rotate in this order, because Vercel needs a redeploy to pick up an environment change while Fly does not.
```sh
NEW=$(openssl rand -hex 32)

cd brick.intel
vercel env rm INGEST_SECRET production --yes && printf %s "$NEW" | vercel env add INGEST_SECRET production
vercel env rm BRICKSTON_ITEMS_HUB_INGEST_SECRET production --yes && printf %s "$NEW" | vercel env add BRICKSTON_ITEMS_HUB_INGEST_SECRET production

vercel redeploy <current-prod-url>        # roughly two minutes, opens the window
fly secrets set BRICKSTON_ITEMS_HUB_INGEST_SECRET="$NEW" -a brickston-backend   # roughly 40 seconds, closes it
```

**How to confirm it worked:**
```sh
curl -so /dev/null -w '%{http_code}\n' -X POST https://intel.lfiq.app/api/ingest/entity-tags \
  -H "x-ingest-secret: $TOKEN" -H 'content-type: application/json' -d '{}'
```
403 means the token was rejected. 400 means the token was accepted and the empty body was rejected, which is the success signal.

Never probe a secret with `${VAR:+SET}${VAR:-MISSING}`. That expands both branches and prints the value. Use `${VAR:+SET}` alone.

### Symptom: a call that looks authenticated in the browser still fails against the backend

**Cause:** a browser session is not a machine credential. The Brick chat proxy routes strip the inbound `Authorization` header on purpose, because a session JWT is not a valid platform bearer token, and then attach the machine credentials plus `X-Brick-Operator-Email`. If the proxy skips that step, the backend sees an anonymous request.

**Fix:** in any new proxy route, remove the inbound `Authorization`, attach the scheduler secret, and forward the operator email. The metrics endpoints on the backend depend on the operator email being present.

**Not verified, confirm with Justin:** these proxy routes also carry a Google ID token path, minted from `BRICKSTON_CLOUD_RUN_INVOKER_SA_JSON`, which existed because the backend ran behind Cloud Run IAM. `brickston-backend` now runs on Fly, so whether that ID-token branch is still required is unresolved. Do not delete it based on this page alone.

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

**Cause:** stale client configuration pointing at a retired endpoint. `brick-mcp-server` moved off Cloud Run on 2026-08-06. The old `.run.app` URL now returns a plain 404 because the service is gone, not because you are unauthenticated.

**Fix:** point clients at the current hosts.

| Server | Current URL |
|--------|-------------|
| Brick MCP | `https://brick-mcp.lfiq.app/mcp` |
| Keystone MCP | `https://keystone-mcp.lfiq.app/mcp` |

Check `~/.cursor/mcp.json` and the Claude Code global config. A stdio entry that shells into a local Docker container is stale; the local container fleet is retired. Restart the client after editing a global config.

**How to confirm it worked:** a POST to the Brick MCP URL with the bearer token returns 200. A request to the Keystone MCP URL returning 400 `Missing session ID` is expected protocol behavior without an `initialize` handshake first, not an auth failure.

## Related pages

- [Common Errors](/docs/common-errors)
- [Clerk Authentication](/docs/clerk-auth)
- [Vercel Debugging](/docs/vercel-debugging)
- [Logins and Auth](/docs/getting-started/logins)
- [Architecture](/docs/architecture)
