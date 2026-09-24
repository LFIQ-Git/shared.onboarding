# Clerk Authentication

One Clerk instance covers the whole BRICK app family. Sign in once and you are authenticated everywhere. Access to individual apps is decided by Clerk organization role, and the database is only a projection of what Clerk says.

The migration to Clerk completed 2026-06-20. NextAuth v5 and the internal `@brick/auth` package were removed from the fleet at that point, with two exceptions noted below.

## The instance

| Item | Value |
|------|-------|
| Clerk instance ID | `ins_3EGuVHIbsu0gwWFLNxiPgUmI49e` |
| Clerk Frontend API | `clerk.lfiq.app` |
| Clerk Account Portal | `accounts.lfiq.app` |
| SDK | `@clerk/nextjs` v7.4.x |
| Sign-up mode | Restricted (invite and allowlist only) |

## Where you actually sign in

You sign in at `https://<app>.lfiq.app/login`. Every app renders Clerk in place on its own `/login` route rather than handing off to a Clerk-hosted page. Verified live on hub, command, intel, keystone and registry. Unauthenticated traffic is redirected there, so `https://command.lfiq.app/` returns a 307 to `https://command.lfiq.app/login`.

The route is `/login`, not `/sign-in`. On Hub and Command, `/sign-in` redirects to `/login`. On Intel and Keystone it is a 404. Any doc that sends you to `/sign-in` is wrong.

The two Clerk domains are easy to confuse, and neither is where you sign in:

| Domain | What it is | Do you open it |
|--------|-----------|----------------|
| `clerk.lfiq.app` | Clerk Frontend API. Returns JSON, carries `noindex`. It is the value encoded in the publishable key. | No, it is infrastructure |
| `accounts.lfiq.app` | Clerk Account Portal, Clerk's stock hosted pages | Not for sign-in, but see below |

The apps deliberately bypass the Account Portal on the way in, using `<SignIn routing="path" path="/login">`. This is the fleet contract, documented in `packages/ui/src/components/sub-app-auth.tsx`. The portal is not dead, though. The instance still sets `user_profile_url` and `after_sign_out_all_url` to `accounts.lfiq.app`, so profile management and signing out of all sessions do land there.

Some repository CLAUDE.md files describe `accounts.lfiq.app` as the shared sign-in domain. That is stale. Use `<app>.lfiq.app/login`.

### One exception: risk.lfiq.app is a satellite domain

`risk.lfiq.app` is a legacy alias for the Civic app. Both it and `civic.lfiq.app` are live and neither redirects to the other. It is registered with Clerk as a satellite domain, and a satellite cannot render its own sign-in or resolve a relative `/login`. So signing in from `risk.lfiq.app` sends you to the primary's absolute URL, `https://civic.lfiq.app/login`. That cross-origin hop is correct behavior, not a misconfiguration.

The rule lives in `apps/civic/lib/satellite-config.ts` and is shared by both the edge middleware and the layout so the two request-time configs cannot drift.

## Sign-in methods

Social only. No passwords, no passkeys, no email codes, no magic links.

| Method | Enabled |
|--------|---------|
| Google OAuth | Yes |
| Microsoft OAuth | Yes |
| Password | No |
| Email code or link | No |

The email allowlist gates sign-ups, not sign-ins. An existing user always keeps access until their org membership is removed.

| Allowed domain | Organization |
|----------------|--------------|
| `*@lfiq.app` | LFI workspace |
| `*@leftfieldinv.com` | Left Field Investments |
| `*@mosserco.com` | Mosser Companies |

The allowlist lives in the Clerk dashboard under Configure, then Restrictions. It is not in code and the Clerk Backend API does not expose it, so you cannot read it from a script. Domain allowlisting plus restricted sign-up is a paid Clerk feature; dropping to the free plan would require moving the domain check into middleware first.

## Roles and app access

Two roles. Clerk organization role is the source of truth and everything else derives from it.

| BRICK role | Clerk org role | Apps granted | Admin panel |
|------------|----------------|--------------|-------------|
| `brick_admin` | `org:admin` | hub, command, intel, keystone, registry, sticks, stacks | Yes |
| `command_user` | `org:member` | command, registry, sticks, stacks | No |

Per-app permissions are Clerk permission strings: `org:brick:hub`, `org:brick:cockpit` (Command still uses the legacy key), `org:brick:intel`, `org:brick:keystone`, `org:brick:registry`, `org:brick:sticks`, `org:brick:stacks`, and `org:brick:admin`. User administration additionally requires `org:sys_memberships:manage`, granted only to `brick_admin`.

Resolution logic lives in `brick.hub/hub/lib/brick-roles.ts`. If the session has `org:admin` the user resolves to `brick_admin`; `org:member` resolves to `command_user`; anything else gets no access.

Apps check membership two ways depending on age. Intel, Keystone, and Stacks check that `sessionClaims.apps` contains their app key. Registry checks the Clerk org permission `org:brick:registry` directly and deliberately fails open on a missing claim, so that Hub's SSO cookie carries in without a claim refresh.

## Which app uses what

| App | Auth |
|-----|------|
| Hub | Clerk |
| Command (`apps/web`) | Clerk |
| Command sub-apps (collect, leasing, repair, documents, utilities, civic, payables) | Clerk, via the shared `createBrickClerkGate` factory |
| Intel | Clerk |
| Keystone | Clerk |
| Registry | Clerk |
| Stacks | Clerk |
| Sticks | NextAuth v5 with Google, allowlist in `AUTH_ALLOWED_EMAILS` |
| leftfieldiq.com | Site-wide password gate, SHA-256 cookie, `SITE_PASSWORD` |

Sticks and the marketing site are the two holdouts. Sticks is the only app left on NextAuth; older Keystone documentation describing an Auth.js Google login is superseded.

## Middleware wiring

The standard pattern, used by every Clerk app except Hub:

```typescript
import { createBrickClerkGate } from "@brick/middleware";
import { isBrickAuthDisabled } from "@/lib/auth-switch";

const clerkGate = createBrickClerkGate("registry");

export default function middleware(req, event) {
  if (isBrickAuthDisabled()) return NextResponse.next();
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  return clerkGate(req, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon\\.png|icon\\.svg).*)",
  ],
};
```

Hub is the exception. Its real gate is `brick.hub/hub/proxy.ts`, re-exported through `middleware.ts`, because it also handles guest cookies and clears stale Clerk cookies on auth failure.

Public routes across apps: `/login(.*)`, `/api(.*)`, `/manifest.webmanifest`, `/sw.js`, `/favicon.ico`, `/robots.txt`, `/icon.png`, `/icon.svg`. Hub adds `/__clerk(.*)` and `/sign-up(.*)`, and its `/` splash has been public since 2026-07-18.

### The module-level pitfall

Two related mistakes, both of which produce failures that do not mention Clerk.

**Do not export an imported matcher config.** Next.js statically analyzes the middleware `config` export at build time and cannot resolve an imported binding. The build does not error loudly; the matcher silently ends up wrong and routes stop being gated.

```typescript
// wrong: Next cannot resolve this at build time
import { BRICK_MIDDLEWARE_CONFIG } from "@brick/middleware";
export const config = BRICK_MIDDLEWARE_CONFIG;

// right: inline object literal in every app's middleware.ts
export const config = { matcher: [ "/((?!_next/static|...).*)" ] };
```

`BRICK_MIDDLEWARE_CONFIG` may be exported from the shared package as a reference value. It cannot be the export itself.

**Do not bypass `clerkMiddleware` to skip auth.** Returning early before Clerk's middleware runs leaves Clerk's request context unset. Every server component that later calls `auth()` throws "Clerk can't detect usage of clerkMiddleware()" and the page 500s during render. Any conditional skip, including the guest bypass, has to run inside the `clerkMiddleware` callback so the context is still established:

```typescript
export default clerkMiddleware(async (auth, req) => {
  if (await isGuestRequest(req)) return;  // context set, protect() skipped
  await auth.protect();
});
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client SDK key |
| `CLERK_SECRET_KEY` | Backend API key, server only |
| `BRICK_CLERK_PUBLISHABLE_KEY` | Fleet-preferred alias for the publishable key |
| `BRICK_CLERK_SECRET_KEY` | Fleet-preferred alias for the secret key |
| `BRICK_CLERK_ORGANIZATION_ID` | The BRICK organization the apps read membership from |
| `BRICK_AUTH_DISABLED` | Local dev bypass |

`clerk-env.ts` resolves keys in a fallback order: the `BRICK_CLERK_*` names first, then `NEXT_PUBLIC_BRICK_CLERK_PUBLISHABLE_KEY`, then the standard Clerk names. If a key looks set but the app still 401s, check which name Vercel actually has.

Hub also needs `NEXT_PUBLIC_COMMAND_BASE_URL` to link to the user admin page, and `BRICK_HUB_MCP_ADMIN_SECRET` for machine access to user management. Sticks needs `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, and `AUTH_ALLOWED_EMAILS`.

## Local development bypass

You do not need a real Clerk session to run an app locally.

```bash
export BRICK_AUTH_DISABLED=true
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_<any-well-formed-test-key>"
export CLERK_SECRET_KEY="sk_test_<any-well-formed-test-key>"
npm run dev
```

`isBrickAuthDisabled()` returns true, every middleware gate passes, and `getCurrentBrickAccess()` returns a synthetic user with all apps unlocked. `useUser()` on the client still returns null, so components that branch on a signed-in user will take the signed-out path.

Two constraints. The bypass only works when `NODE_ENV` is not `production`. The dummy Clerk keys still have to be structurally valid, because `ClerkProvider` decodes the publishable key at mount and crashes on garbage. You will see a harmless console warning about Clerk being unable to attribute the request.

## Guest login

A signed cookie bypass exists for demos. It is a genuine Clerk bypass, not a Clerk user.

| Item | Value |
|------|-------|
| Cookie | `brick_guest`, HttpOnly, scoped to `.lfiq.app` |
| Format | `guest.<unix-expiry>.<hmac-sha256>` |
| Lifetime | 12 hours |
| Entry point | `POST /api/guest-login` |
| Exit point | `POST /api/guest-logout` |
| Env vars | `GUEST_EMAIL`, `GUEST_PASSWORD`, `GUEST_COOKIE_SECRET` |
| Implemented in | Hub, Command web, Registry, Stacks (`lib/guest-auth.ts` in each) |

The credential check is constant-time and the signing uses Web Crypto only, so it runs on the edge runtime. The feature is dormant unless all three environment variables are set; without them the login form is hidden and the route returns 503. Because the cookie is scoped to `.lfiq.app`, one guest login covers every app that shares the same `GUEST_COOKIE_SECRET`.

## Provisioning a new user

Clerk is the source of truth. The `items.auth_allowed_users` table in Neon is a read-only projection, refreshed by `syncClerkMembershipsToAllowedUsers()` when an admin loads the users page. Editing the table directly does nothing.

Two supported paths:

**Through the app.** An account with `brick_admin` opens the user admin page in Command, enters email, role, display name, and notes. One action creates the Clerk user, adds the organization membership with the chosen role, and upserts the projection row. The form blocks removing the last admin and blocks self-deletion.

**Through the Clerk dashboard.** Open the BRICK organization, invite the member, pick the role. The user accepts the emailed invite. The projection row syncs on the next admin page load.

The API behind the page:

| Route | Auth | Use |
|-------|------|-----|
| `GET/POST/PATCH/DELETE /api/admin/users` | Clerk session with `org:admin` | Interactive admin |
| `/api/brick-mcp-admin/users` | `X-Brick-Hub-Mcp-Secret` header matching `BRICK_HUB_MCP_ADMIN_SECRET`, plus `X-Brick-Actor-Email` for audit | Machine and agent access |

Mutations through the session route require a real Clerk `userId`, so they do not work while `BRICK_AUTH_DISABLED` is set.

Removing someone: revoke the Clerk organization membership. That is the whole action. The projection catches up on the next sync, and Command runs a `sync-clerk-allowlist` cron daily at 11:00 UTC.

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
- [Vercel Deployment](/docs/vercel-deployment) for where these environment variables are set
- [Getting Started: Logins](/docs/getting-started/logins) for your own account setup
- Justin holds the Clerk admin account. Only a `brick_admin` can provision users.
