# Cloudflare Debugging

Seventeen BRICK Workers in one account, one repo that fans out into eight of them, and two build toolchains. Most Worker problems on this fleet come from a build that emitted the wrong output, config that a deploy silently replaced, or Cloudflare Access answering before your code runs.

## Triage table

| What you see | Go to |
|--------------|-------|
| `wrangler deploy` uploads, then exits 1 on an authentication error | [Deploys](#deploys) |
| Workers Builds fails at the deploy step on every push | [Deploys](#deploys) |
| A bare `npx wrangler deploy` starts an OpenNext migration | [Deploys](#deploys) |
| `Cannot find package 'esbuild'` in a Workers Build | [Deploys](#deploys) |
| Workers Builds reports a name mismatch and offers an auto-fix PR | [Deploys](#deploys) |
| A var or a cron vanished after a deploy | [Config and secrets](#config-and-secrets) |
| `10053 Binding name already in use` from `wrangler secret put` | [Config and secrets](#config-and-secrets) |
| `10214` when you edit a Worker's settings | [Config and secrets](#config-and-secrets) |
| Every URL returns 302 to `lfiq.cloudflareaccess.com` | [Access](#access) |
| Every request returns 401 right after a deploy | [Access](#access) |
| A scheduled job reports success but did nothing | [Cron triggers](#cron-triggers) |
| A job fires an hour off, or at the wrong time | [Cron triggers](#cron-triggers) |
| A Worker writes to a database nobody else reads | [Database bindings](#database-bindings) |

## The map you are debugging against

Account `Left Field`, ID `c16c7246ee0a89e6deafe19a74480c6a`. GitHub org `LFIQ-Git`. The full repository to Worker table is on [Cloudflare Deployment](/docs/cloudflare-deployment).

```bash
export CLOUDFLARE_ACCOUNT_ID=c16c7246ee0a89e6deafe19a74480c6a
npx wrangler deployments list --name brick-intel   # what is live, when, and how it got there
npx wrangler tail brick-intel                      # live request and exception log
```

Every Worker config sets `observability.enabled`, so the same logs are in the dashboard under Workers, the Worker, Logs.

## Deploys

### Symptom: `wrangler deploy` uploads the script, then exits 1 on an authentication error

**Cause:** the Wrangler config has a `routes` block. That makes Wrangler call the zone Workers Routes API, and the deploy token (Keychain `com.justinsato.cloudflare.api-token`) does not carry that permission. The script is already live when the error prints.

**Fix:** keep custom domains out of the config for Workers that bind them out of band, and bind the hostname through the Workers Domains API. The exact call is in the comment block of each affected `wrangler.jsonc` and on [Cloudflare Deployment](/docs/cloudflare-deployment#custom-domains).

**How to confirm it worked:** `npx wrangler deployments list --name <worker>` shows the new deployment at the top, and the hostname returns the Access 302.

### Symptom: Workers Builds fails at the deploy step on every push

**Cause:** the build step ran plain `next build`, which writes no `dist/client` or `.open-next/assets`, so the directory the Wrangler `assets` block points at does not exist. This is the `Workers Builds: brick-stacks` failure on Stacks PR #100.

**Fix:** make the script Workers Builds runs emit the Worker build. Stacks' `npm run build` checks `WORKERS_CI=1` and runs `vinext build`. Registry's `build` is `opennextjs-cloudflare build`, with `build:next` as the plain Next build that `open-next.config.ts` calls, because OpenNext otherwise shells out to `npm run build` and recurses forever. Keep those two in sync.

**How to confirm it worked:** the Workers Builds log in the dashboard shows the deploy step completing. Do not trust the GitHub check's duration. It reports identical start and end timestamps even when the build ran to completion.

### Symptom: a bare `npx wrangler deploy` in a vinext repo tries to install and run OpenNext

**Cause:** Wrangler 4 autoconfig treats the Next.js app as unconfigured and runs the OpenNext migration. Intel, Keystone, Stacks and Command `leasing` build with vinext, not OpenNext.

**Fix:** use the repo's script. Intel: `npm run cf:workers-deploy`, which passes `--autoconfig=false` and `dist/server/wrangler.json`. Keystone and leasing: `npm run deploy:cloudflare`.

**How to confirm it worked:** the output names `dist/server/wrangler.json` as the config and never mentions `@opennextjs/cloudflare migrate`.

### Symptom: `Cannot find package 'esbuild'` in a Registry Workers Build

**Cause:** `@opennextjs/cloudflare` imports esbuild without declaring it. Once other packages pulled in different esbuild majors, npm stopped hoisting any of them.

**Fix:** Registry keeps `esbuild` as a direct devDependency on the 0.28 line. Do not remove it, and do not drop it to 0.25, which vite 8's peer range rejects.

**How to confirm it worked:** `npm ls esbuild` shows the direct dependency and the Workers Build passes the OpenNext step.

### Symptom: Workers Builds flags a name mismatch and offers an auto-fix PR

**Cause:** Workers Builds compares the `name` in the Wrangler config with the Worker it is attached to. A Worker cannot be renamed in place, so renaming means a new Worker, every secret re-entered by hand, and the custom domain moved. `brick.watch` flip-flopped between two names across PRs #53 and #56.

**Fix:** do not accept the auto-fix. Find the stray Worker that carries the Git connection and detach it. The production names are the ones in the Wrangler files: `brick-stacks`, `brick-sticks`, `brick-watch` and so on.

**How to confirm it worked:** the next push builds against the Worker whose name matches the config, and `npx wrangler deployments list --name <that name>` shows it.

## Config and secrets

### Symptom: a var, a route, or a cron disappeared after a deploy

**Cause:** Wrangler replaces `vars`, `routes` and `triggers.crons` wholesale from the config file on every deploy. Anything set in the dashboard and not in the file is deleted. Secrets are the exception and survive.

**Fix:** put every non-secret value in the Wrangler file. Workers that set `keep_vars: true` (Hub, Registry, Watch, and every Command app except `leasing`) keep dashboard vars across deploys, but the file is still the only reviewable copy.

**How to confirm it worked:** the Worker's Settings, Variables page lists what the file lists, and a second deploy changes nothing.

### Symptom: `wrangler secret put DATABASE_URL` fails with `10053 Binding name already in use`

**Cause:** a plain-text var of the same name already exists on the Worker. Seen on `brick-intel` on 2026-09-11.

**Fix:** remove the var from the Wrangler file and the Worker, then set the secret. Do not keep both.

**How to confirm it worked:** `npx wrangler secret list --name <worker>` lists the name, and the Variables page no longer shows it as plain text.

### Symptom: a settings edit on a Worker is refused with `10214`

**Cause:** the newest uploaded version is not the deployed one. Cloudflare refuses settings edits in that state. `brick-watch` hit this on 2026-09-11 with a version uploaded the day before and never rolled out.

**Fix:** diff the pending version against the deployed one. If handlers, compatibility flags and bindings match, deploy the pending version, then make the edit.

**How to confirm it worked:** `npx wrangler deployments list --name <worker>` shows the newest version at 100%, and the settings edit goes through.

## Access

### Symptom: every URL on a production hostname returns 302 to `lfiq.cloudflareaccess.com`

**Cause:** Cloudflare Access fronts every app. An unauthenticated request never reaches the Worker. This is normal.

**Fix:** nothing. Check it is Access and not your code:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://intel.lfiq.app/
```

**How to confirm it worked:** the redirect URL starts with `https://lfiq.cloudflareaccess.com/cdn-cgi/access/login/`, and the same path loads in a signed-in browser.

### Symptom: every request returns 401 right after a deploy

**Cause:** the Access JWT verifier (`lib/access-jwt.ts`) shipped without matching `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` vars. They are vars, not secrets, so the verifier and its values deploy in the same push. An app fronted by more than one Access application needs every audience, comma-separated. Intel lists two, one for people and one for the machine callers on `/api/ingest`. Leasing lists three.

**Fix:** set `CF_ACCESS_AUD` in the Wrangler file to every audience that fronts the hostname, and redeploy. Never copy another app's AUD; the verifier would then accept tokens minted for that app.

**How to confirm it worked:** a signed-in browser loads the app, and a machine caller with a service token gets past the gate.

## Cron triggers

### Symptom: a scheduled job reports success but nothing happened

**Cause:** the `scheduled()` handler fetched its own public hostname. Access answered with a 302 to the login page, fetch followed it and got a 200, and the job looked successful without running. Stacks shipped this way until 2026-09-23.

**Fix:** dispatch in-process. Stacks' `scheduled()` now calls its routes through the vinext fetch handler directly. Do not go back to a network self-fetch unless you also add an Access service token.

**How to confirm it worked:** the data the job writes changes after each tick, not just the Worker's invocation log.

### Symptom: a job fires an hour off, or at a time that does not match its label

**Cause:** Cloudflare cron triggers are UTC only. A Pacific schedule written as a UTC cron drifts an hour at each DST change.

**Fix:** follow the `brick-cron-http` pattern. It has one `*/5 * * * *` trigger, converts each fire to America/Los_Angeles, and runs the entries in `schedule.json` that are due. Every schedule minute there must be a multiple of 5, and a test enforces it.

**How to confirm it worked:** `GET /last-success` on the Worker returns a recent `<ts> <label>`, and `portfolio.scheduled_job_runs` shows the run for Command service jobs.

### Symptom: a `brick-cron-http` job never runs

**Cause:** the Worker is gated. `CRON_ENABLED` must be `1` and the label must be in `CRON_JOBS`, both Worker secrets. The backend's per-job toggle on `/admin/jobs` is a third, independent gate; a disabled job still gets POSTed and records `skipped`.

**Fix:** check all three gates. To fire one job now without the gates, use "Run now" on `/admin/jobs`, or `POST /run/<label>` on the Worker with the `X-Scheduler-Secret` header when the backend UI is down.

**How to confirm it worked:** a row appears in `portfolio.scheduled_job_runs` for that job.

## Database bindings

### Symptom: a Worker writes rows that no other app can see

**Cause:** the Worker's `DATABASE_URL` still points at a retired Neon endpoint. On 2026-09-11 `brick-intel` and `brick-watch` were found writing to `ep-tiny-lab-akrddwgy` in the old Neon org while the rest of the fleet had moved to `ep-hidden-union-aromj80p` in `lfiq-command`. Three days of Intel writes had to be merged forward.

**Fix:** repoint the secret at the `lfiq-command` endpoint with the app's scoped role. See [Neon Database](/docs/neon-database).

**How to confirm it worked:** `select current_user, current_database()` through the app returns the scoped role, and new rows appear in `lfiq-command`.

## Related pages

- [Cloudflare Deployment](/docs/cloudflare-deployment)
- [Common Errors](/docs/common-errors)
- [Authentication Issues](/docs/auth-issues)
- [Neon Debugging](/docs/neon-debugging)
- [Architecture](/docs/architecture)
