# Authentication

Cloudflare Access fronts every BRICK app. Access decides who you are. The `items.auth_allowed_users` table in Neon decides what you may open. Clerk is retired: the fleet cut over to Access on 2026-09-13, Command and the other apps dropped their Clerk org on 2026-09-14, and Hub removed its last Clerk modules on 2026-09-17. `clerk.lfiq.app` and `accounts.lfiq.app` no longer resolve in DNS.

If a repository doc or `.env.example` still names Clerk variables, treat them as dead configuration.

## The perimeter

| Item | Value |
|------|-------|
| Access team domain | `lfiq.cloudflareaccess.com` (`CF_ACCESS_TEAM_DOMAIN` = `lfiq`) |
| Access applications | One per hostname, each with its own `CF_ACCESS_AUD` |
| Identity header | `Cf-Access-Jwt-Assertion`, a signed JWT verified by each app's `lib/access-jwt.ts` |
| Convenience header | `Cf-Access-Authenticated-User-Email`, used only as a fallback for service tokens |
| Grant of record | `items.auth_allowed_users` (`apps[]`, `is_admin`, `role_ids[]`) |

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are not secrets. In production they ship as `vars` in each app's `wrangler.jsonc` or `wrangler.toml`.

## Where you actually sign in

You do not sign in on the app. Open `https://<app>.lfiq.app` and Access redirects you to `https://lfiq.cloudflareaccess.com/cdn-cgi/access/login/<app>.lfiq.app`. Verified live on hub, command, intel, keystone, registry, stacks, sticks, civic and risk: each returns a 302 to that URL when you have no Access session.

Each app still has a `/login` route, but it no longer renders a sign-in form. Access challenges before the request reaches the Worker, so anyone who reaches `/login` has already cleared Access. The page does the one check middleware cannot: it looks up your address in `items.auth_allowed_users` and either sends you on or tells you access is not enabled for that address. It also hosts the guest form on the apps that support it.

`risk.lfiq.app` is a legacy alias for the Civic app. It used to be a Clerk satellite domain that bounced sign-in to `civic.lfiq.app/login`. That configuration was removed from `apps/civic/middleware.ts` because Access authenticates each hostname against its own application, so there is nothing to federate.

## Sign-in methods

The Access login page offers three methods, read from the live page:

| Method | Enabled |
|--------|---------|
| Google | Yes |
| Microsoft Entra ID (Azure AD) | Yes |
| Emailed one-time code | Yes |

Which email addresses or domains the Access policies admit is configured in the Cloudflare Zero Trust dashboard, not in code. Clearing Access is not enough on its own: without a row in `items.auth_allowed_users` the app shows the not-enabled notice.

## Roles and app access

Each app reads your row in `items.auth_allowed_users`. `apps[]` is the per-user grant and `is_admin` gates user administration. The role vocabulary lives in `brick-roles.ts` (Hub and Command each carry a copy) and is written to `role_ids[]` by Command.

| BRICK role | Default apps | Admin |
|------------|--------------|-------|
| `brick_admin` | hub, cockpit (Command), intel, keystone, registry, sticks, stacks, back9 | Yes |
| `command_user` | cockpit (Command), registry, sticks, stacks | No |

Intel and Keystone are listed in code as owner-only apps: they hold one person's mail, calendar and tasks, so access is meant to be an explicit per-user grant.

Hub is the exception on entry. Having any row in the table gets you into Hub, because most rows were never backfilled with `hub` in `apps[]`. `BRICK_MASTER_ADMIN_EMAILS` is a break-glass list that always resolves to full access, so an admin can repair the table even if their own row is wrong.

## Which app uses what

| App | Auth |
|-----|------|
| Hub | Cloudflare Access + `items.auth_allowed_users` |
| Command (`apps/web`) | Cloudflare Access + `items.auth_allowed_users` |
| Command sub-apps (civic, collect, documents, leasing, payables, repair, utilities) | Cloudflare Access, via `createBrickAccessGate` in `@brick/middleware` |
| Intel | Cloudflare Access + `items.auth_allowed_users` |
| Keystone | Cloudflare Access + `items.auth_allowed_users` |
| Registry | Cloudflare Access + `items.auth_allowed_users` |
| Stacks | Cloudflare Access + `items.auth_allowed_users` (app key `stacks`) |
| Sticks | Cloudflare Access + `items.auth_allowed_users` (app key `sticks`) |
| leftfieldiq.com | Site-wide password gate, SHA-256 cookie, `SITE_PASSWORD` |

Sticks no longer runs NextAuth. `auth.ts` and `app/api/auth` are gone and `lib/auth/session.ts` resolves the user from Access. Its `.env.example` and CLAUDE.md still describe the old Google login.

## Middleware wiring

Middleware runs in the Edge runtime and cannot reach Postgres. It only proves an Access identity is present by verifying the signed JWT. Authorization happens later, on the `/login` page and in server-side helpers that can query the table.

The Command sub-app pattern:

```typescript
import { createBrickAccessGate } from "@brick/middleware";

const accessGate = createBrickAccessGate("repair");

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const disabled =
    process.env.BRICK_AUTH_DISABLED === "1" ||
    process.env.BRICK_AUTH_DISABLED === "true" ||
    process.env.BRICK_AUTH_ENABLED === "false";
  if (disabled || process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }
  return accessGate(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon\\.png|icon\\.svg).*)",
  ],
};
```

Standalone apps (Hub, Intel, Keystone, Registry, Stacks, Sticks) carry their own `middleware.ts` with the same shape: a public-route list, then `verifyAccessJwt` on the `cf-access-jwt-assertion` header. Until 2026-09-23 the gates only checked that the plain email header was present, which is safe only while an Access application fronts the hostname. They now verify the signature so a missing Access app produces a 401 instead of an open door.

Public routes are `/login` and `/api` in every app, plus PWA assets such as `/manifest.webmanifest` and icons. API routes enforce their own machine-secret or operator checks in-route.

### The module-level pitfall

**Do not export an imported matcher config.** Next.js statically analyzes the middleware `config` export at build time and cannot resolve an imported binding. The build does not error loudly; the matcher silently ends up wrong and routes stop being gated. Inline the object literal in every app's `middleware.ts`.

```typescript
// wrong: Next cannot resolve this at build time
import { BRICK_MIDDLEWARE_CONFIG } from "@brick/middleware";
export const config = BRICK_MIDDLEWARE_CONFIG;

// right: inline object literal in every app's middleware.ts
export const config = { matcher: [ "/((?!_next/static|...).*)" ] };
```

**Do not put the allowlist lookup in middleware.** Anything that imports the `postgres` client breaks the edge bundle. That is why each app imports the header name from a separate `lib/access-header.ts`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CF_ACCESS_TEAM_DOMAIN` | Access team name used to fetch signing keys (`lfiq`) |
| `CF_ACCESS_AUD` | The Access application audience tag for this hostname |
| `ITEMS_HUB_DATABASE_URL` | Neon DSN holding `items.auth_allowed_users` |
| `BRICK_MASTER_ADMIN_EMAILS` | Break-glass admin addresses (Hub) |
| `BRICK_AUTH_ENABLED` | `true` enables the gate; unset or unrecognised also leaves it on |
| `BRICK_AUTH_DISABLED` | Local dev bypass, honored only outside production |

Command's machine user-admin route also needs `BRICK_MACHINE_ADMIN_SECRET`.

## Local development bypass

Locally there is no Access application in front of the app, so there is no JWT to verify.

```bash
export BRICK_AUTH_DISABLED=true
npm run dev
```

The auth switch fails closed. An explicit `BRICK_AUTH_ENABLED=true` enables auth, an explicit false value disables it only when `NODE_ENV` is not `production`, and anything else, including a typo, leaves auth on. With the bypass on, the apps resolve a synthetic operator with every app unlocked. Mutations that record who acted are attributed to a placeholder actor such as `auth-disabled-master-switch`.

## Guest login

A signed cookie path exists for demos. It bypasses the app's own gate, not Cloudflare Access.

| Item | Value |
|------|-------|
| Cookie | `brick_guest`, HttpOnly, scoped to `.lfiq.app` |
| Format | `guest.<unix-expiry>.<hmac-sha256>` |
| Lifetime | 12 hours |
| Entry point | `POST /api/guest-login` |
| Exit point | `POST /api/guest-logout` |
| Env vars | `GUEST_EMAIL`, `GUEST_PASSWORD`, `GUEST_COOKIE_SECRET` |
| Implemented in | Hub, Command web, Registry, Stacks (`lib/guest-auth.ts` in each) |

The credential check is constant-time and the signing uses Web Crypto only, so it runs on the edge runtime. The feature is dormant unless all three environment variables are set. Because the cookie is scoped to `.lfiq.app`, one guest login covers every app that shares the same `GUEST_COOKIE_SECRET`.

## Provisioning a new user

`items.auth_allowed_users` is the source of truth. There is no invite step: Access authenticates against the identity provider directly, so adding a row is the whole grant and it takes effect on the person's next request. Rows are keyed by email address.

**Through the app.** An account with `is_admin` opens `/admin/users` in Command, enters the email, role, display name and notes, and can set the per-app grants. The API blocks removing the last admin.

**Through the machine route.** Agents and the `hub_admin_users_*` MCP tools use Command's machine route.

| Route | Auth | Use |
|-------|------|-----|
| `GET/POST/PATCH/DELETE /api/admin/users` (Command) | Access identity whose row has `is_admin` | Interactive admin |
| `GET/POST/DELETE /api/machine/users` (Command) | `X-Brick-Machine-Secret` header matching `BRICK_MACHINE_ADMIN_SECRET` | Machine and agent access |

Mutations through the session route need a real identity, so they are attributed to a placeholder actor while `BRICK_AUTH_DISABLED` is set.

Removing someone: delete their row. That is the whole action.

## Login page branding

Every app's login page follows the same template.

| Element | Content |
|---------|---------|
| Heading | The app name only: Hub, Command, Intel, Keystone, Registry, Stacks, Sticks |
| Subtitle | `lfiq tech` |
| Access line | Access restricted to authorized lfiq tech accounts. |
| Family line | Part of the lfiq BRICK app family |

Do not write `LFI`, `by LFI`, `LFIQ operators`, `Sign in to Brickston AI`, or any retired app name such as Runner or Cockpit. The brand is `lfiq` and the cohort word is `tech`.

## Where to get help

- [Authentication Issues](/docs/auth-issues) for login failures and 403s
- [Architecture](/docs/architecture) for how auth sits across the app family
- [Cloudflare Deployment](/docs/cloudflare-deployment) for where these environment variables are set
- [Getting Started: Logins](/docs/getting-started/logins) for your own account setup
- Only an `is_admin` account can provision users.
