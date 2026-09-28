# Cloudflare Deployment

Every LFIQ front end runs as a Cloudflare Worker in the `Left Field` account. Each repository carries its own Wrangler config, and the build toolchain is not uniform: some apps build with OpenNext, others with vinext. Read the map below before you deploy anything by hand.

## The account

| Item | Value |
|------|-------|
| Cloudflare account | `Left Field`, ID `c16c7246ee0a89e6deafe19a74480c6a` |
| `lfiq.app` zone ID | `085a0957f3a767777df1771df512ffa3` |
| GitHub organization | `LFIQ-Git` |
| Access team domain | `lfiq` (`lfiq.cloudflareaccess.com`) |

`npx wrangler whoami` also lists a second account, `Sato Personal Apps`. Set `CLOUDFLARE_ACCOUNT_ID=c16c7246ee0a89e6deafe19a74480c6a` before any read or deploy so Wrangler does not prompt or pick the wrong one.

## Repository to Worker map

`brick.command` is an npm-workspaces monorepo. Each app under `apps/` has its own `wrangler.jsonc` and deploys as its own Worker.

| Repository | Config | Worker | Hostname | Build | Hostname in config |
|------------|--------|--------|----------|-------|--------------------|
| `brick.hub` | `hub/wrangler.jsonc` | `brick-hub` | https://hub.lfiq.app | OpenNext | No |
| `brick.intel` | `wrangler.toml` | `brick-intel` | https://intel.lfiq.app | vinext | No |
| `brick.keystone` | `wrangler.jsonc` | `brick-keystone` | https://keystone.lfiq.app | vinext | Yes |
| `brick.registry` | `wrangler.jsonc` | `brick-registry` | https://registry.lfiq.app | OpenNext | Yes |
| `brick.stacks` | `wrangler.toml` | `brick-stacks` | https://stacks.lfiq.app | vinext | Yes |
| `brick.sticks` | `wrangler.jsonc` | `brick-sticks` | https://sticks.lfiq.app | OpenNext | Yes |
| `brick.watch` | `wrangler.jsonc` | `brick-watch` | https://watch.lfiq.app | OpenNext | Yes |
| `brick.command` | `apps/web/wrangler.jsonc` | `brick-command` | https://command.lfiq.app | OpenNext | No |
| `brick.command` | `apps/collect/wrangler.jsonc` | `brick-collect` | https://collect.lfiq.app | OpenNext | No |
| `brick.command` | `apps/repair/wrangler.jsonc` | `brick-repair` | https://repair.lfiq.app | OpenNext | No |
| `brick.command` | `apps/documents/wrangler.jsonc` | `brick-documents` | https://document.lfiq.app | OpenNext | No |
| `brick.command` | `apps/utilities/wrangler.jsonc` | `brick-utilities` | https://utility.lfiq.app | OpenNext | No |
| `brick.command` | `apps/civic/wrangler.jsonc` | `brick-civic` | https://civic.lfiq.app, https://risk.lfiq.app | OpenNext | No |
| `brick.command` | `apps/payables/wrangler.jsonc` | `brick-payables` | https://payables.lfiq.app | OpenNext | No |
| `brick.command` | `apps/leasing/wrangler.jsonc` | `brick-leasing` | https://leasing.mosser.app | vinext | No |
| `brick.command` | `workers/leasing-redirect/wrangler.jsonc` | `brick-leasing-redirect` | https://leasing.lfiq.app, 308 to the Mosser host | none | No |
| `brick.hub` | `docs/migration-artifacts/cloudflare/brick-cron-http/wrangler.jsonc` | `brick-cron-http` | none | none | n/a |

Two hostnames are singular on purpose: `document.lfiq.app` and `utility.lfiq.app`. The plural forms do not resolve. The configs say to match them to the `NEXT_PUBLIC_*_URL` defaults in `packages/ui/src/lib/command-apps.ts`, or the app-family links point nowhere while the build stays green.

`runner.lfiq.app`, `cockpit.lfiq.app`, `box.lfiq.app` and `kit.lfiq.app` do not resolve.

Every hostname above sits behind Cloudflare Access. An unauthenticated request returns a 302 to `lfiq.cloudflareaccess.com`, which means the Worker is up and you are not signed in. Each app's `CF_ACCESS_AUD` var holds the audience of its Access application; Intel and leasing list more than one because more than one Access application fronts them.

## Custom domains

A hostname marked "No" above is bound outside the Wrangler config. A `routes` entry makes `wrangler deploy` call the zone Workers Routes API, and the deploy token (Keychain `com.justinsato.cloudflare.api-token`) does not carry that permission. The script uploads, then the command exits 1 on an authentication error, which reads like a failed deploy while the Worker is actually live.

Bind a hostname with the Workers Domains API instead, as the configs document:

```
PUT /accounts/{account_id}/workers/domains
{"environment":"production","hostname":"command.lfiq.app",
 "service":"brick-command","zone_id":"085a0957f3a767777df1771df512ffa3"}
```

That call writes its own proxied DNS record. No manual DNS change is needed.

## How production deploys

`brick.stacks`, `brick.sticks` and `brick.registry` document Cloudflare Workers Builds deploying on push to `main`. For any other Worker, check Settings, Build on that Worker in the dashboard before you assume a push shipped.

The laptop path is the same npm script in every repo:

```bash
cd brick.stacks
npm run deploy:cloudflare
```

For the Command apps, run it from the app directory, not the repo root:

```bash
cd brick.command/apps/web && npm run deploy:cloudflare
cd ../collect && npm run deploy:cloudflare
```

What `deploy:cloudflare` runs differs by toolchain:

| Toolchain | Repos | `deploy:cloudflare` |
|-----------|-------|---------------------|
| OpenNext (`@opennextjs/cloudflare` 1.20.6) | hub, registry, sticks, watch, Command `web`, `collect`, `repair`, `documents`, `utilities`, `civic`, `payables` | `opennextjs-cloudflare build` then `opennextjs-cloudflare deploy` |
| vinext (`vinext` 1.0.0-beta.9) | intel, keystone, stacks, Command `leasing` | `vinext build`, then `vinext-cloudflare deploy --config dist/server/wrangler.json` (stacks runs plain `wrangler deploy`) |

Do not run a bare `npx wrangler deploy` in a vinext repo unless its scripts say to. Intel's `wrangler.toml` warns that Wrangler 4 autoconfig treats the app as unconfigured Next.js and tries to run the OpenNext migration. Intel also ships a wrapper, `scripts/cf-workers-deploy.mjs` (`npm run cf:workers-deploy`, with `npm run cf:workers-dry-run` to check first), which passes `--autoconfig=false` and the generated `dist/server/wrangler.json`.

Workers Builds runs the repo's `build` script, so that script has to emit the directory the Wrangler `assets` block points at. Registry's `build` is `opennextjs-cloudflare build` for exactly this reason, and Stacks' `npm run build` detects Workers Builds and runs `vinext build`. A plain `next build` there produces no assets directory and the deploy step fails.

Check what is live:

```bash
npx wrangler deployments list --name brick-command
```

## Secrets and vars

Credentials are encrypted Worker secrets. Non-secret config lives in the `vars` block of the Wrangler file.

```bash
npx wrangler secret put DATABASE_URL --name brick-intel
npx wrangler secret list --name brick-intel     # names only
npx wrangler secret bulk secrets.json --name brick-command
```

Rules the configs and repo notes spell out:

- `vars` in the Wrangler file are the only copy. Secrets survive a deploy; a plain var missing from the file is deleted from the Worker. The same applies to `routes` and `triggers.crons`, which Wrangler replaces wholesale.
- Every Command app except `leasing`, plus Hub, Registry and Watch, sets `keep_vars: true` so a deploy does not clear values set out of band.
- A plain var and a secret cannot share a name. `wrangler secret put` fails with `10053 Binding name already in use` if a var of the same name exists.
- For local `wrangler dev`, put secrets in `.dev.vars`. Intel, Keystone, Registry, Stacks and Watch gitignore it. Never commit it.

## Cron triggers

Cloudflare cron triggers fire in UTC. The Wrangler config in each repo is the source of truth for cadence.

| Worker | Crons in config |
|--------|-----------------|
| `brick-intel` | 18 entries, from `*/5` up to weekly |
| `brick-stacks` | 9 entries |
| `brick-watch` | 8 entries |
| `brick-sticks` | 4 entries |
| `brick-keystone` | `5 8 * * *` |
| `brick-registry` | `0 14 * * *` |
| `brick-collect` | `0 20 * * *` |
| `brick-command` | none (`crons: []`) |
| `brick-cron-http` | `*/5 * * * *`, which dispatches the 29 Command service jobs |

`brick-cron-http` replaced the HTTP dispatcher on the Fly `brick-cron` app on 2026-09-23. Its schedule lives in `schedule.json`, written in Pacific time; the Worker converts each UTC fire to America/Los_Angeles and runs the jobs that are due, so DST needs no edit. It is gated by the `CRON_ENABLED` and `CRON_JOBS` secrets, the same way `brick-cron` is. Change a schedule by editing `schedule.json` and the matching entry in `brick.command/backend/app/jobs/registry.py` together; `backend/tests/test_fly_cron_matches_registry.py` fails if they drift. Batch jobs that launch Fly machines stay on `brick-cron`. See [Fly.io Backend](/docs/fly-io-backend).

## CI gates

GitHub Actions `ci.yml` runs on `brick.intel`, `brick.keystone`, `brick.command`, `brick.registry` and `brick.stacks`; Hub runs `hub-ci.yml`. `brick.sticks` and `brick.watch` have no workflows.

Intel and Keystone depend on private `LFIQ-Git` git packages. Their `ci.yml` reads a fine-grained PAT from the repo secret `GH_PAT` and rewrites `github.com/LFIQ-Git/` URLs to use it. Intel's checkout sets `persist-credentials: false`, because `actions/checkout` otherwise writes the repo-scoped token into git config and it overrides the PAT rewrite.

## Where to get help

- [Architecture](/docs/architecture) for how the apps relate to each other
- [Cloudflare Debugging](/docs/cloudflare-debugging) for build and runtime failures
- [Neon Database](/docs/neon-database) for the connection strings these Workers need
- [Fly.io Backend](/docs/fly-io-backend) for `brickston-backend`, which the front ends call
- Justin owns the Cloudflare account. Ask before adding a Worker or a hostname.
