# Vercel Debugging

Fifteen production surfaces across one team, and one repo that fans out into eight projects. Most Vercel problems on this fleet come from build cache, environment variables that exist but are empty, or a deploy that did not go where you assumed.

## Triage table

| What you see | Go to |
|--------------|-------|
| `npm error Missing: <pkg> from lock file` on a clean repo | [Build failures](#build-failures) |
| `ENOENT ... .nft.json` at "Collecting build traces" | [Build failures](#build-failures) |
| A production build silently stopped happening | [Build failures](#build-failures) |
| A route 403s then 401s with all env vars "set" | [Environment variables](#environment-variables) |
| `Bad control character ... position 156` in runtime logs | [Environment variables](#environment-variables) |
| Preview deploys always fail, production is fine | [Environment variables](#environment-variables) |
| `git_branch_required` from `vercel env add` | [Environment variables](#environment-variables) |
| Production is running code that is not on `origin/main` | [Deploy targets and promotion](#deploy-targets-and-promotion) |
| You pushed to main and production did not change | [Deploy targets and promotion](#deploy-targets-and-promotion) |
| `Can't find the deployment` from `vercel ls` | [Deploy targets and promotion](#deploy-targets-and-promotion) |
| A production URL returns 404 at `/` | [Deployments that look broken but are not](#deployments-that-look-broken-but-are-not) |
| Every project on the team is paused at once | [Team-wide pause](#team-wide-pause) |

## The map you are debugging against

Team **LFIQ** is `team_N2zeS1e4gX0Wljbp0aKwkzxb`, slug `lfiq`. GitHub org is `LFIQ-Git`.

| Repo | Vercel project | Root directory |
|------|----------------|----------------|
| `brick.hub` | brick.hub | repo root |
| `brick.intel` | brick.intel | repo root |
| `brick.keystone` | brick.keystone | repo root |
| `brick.registry` | brick.registry | repo root |
| `brick.command` | brick.command | `apps/web` |
| `brick.command` | brick.collect | `apps/collect` |
| `brick.command` | brick.leasing | `apps/leasing` |
| `brick.command` | brick.repair | `apps/repair` |
| `brick.command` | brick.documents | `apps/documents` |
| `brick.command` | brick.risk | `apps/risk` |
| `brick.command` | brick.utilities | `apps/utilities` |
| `brick.command` | brick.payables | `apps/payables` |

One push to `brick.command` main can trigger eight builds. Each app keeps its own `apps/<name>/vercel.json`, and the root lockfile is the only lockfile.

## Build failures

### Symptom: `npm error Missing: command-risk@0.1.0 from lock file` on a repo that provably does not contain that workspace

**Cause:** a poisoned Vercel build cache, not a lockfile problem. `apps/risk` was a real workspace named `command-risk` that got deleted. Vercel's per-project build cache still carried the stale workspace directory, the `apps/*` glob in the root `package.json` re-picked it up at build time, and `npm ci` demanded it from the lockfile. Each new deploy restored cache from the previous poisoned deploy, so it never self-healed. The tell is the line `Restored build cache from previous deployment` in the build log header.

**Fix:**
```bash
cd brick.apps/brick.command/apps/web
echo "1" | vercel env add VERCEL_FORCE_NO_BUILD_CACHE production
git commit --allow-empty -m "chore: force no-cache build"
git push origin main
# once the no-cache build is READY:
vercel env rm VERCEL_FORCE_NO_BUILD_CACHE production -y
```

`vercel redeploy <url>` does not work here. It reuses the original deployment's build settings and ignores the new environment variable. The variable is only honored on a normal git or CLI build.

**How to confirm it worked:** the new build log shows no "Restored build cache" line, the install step passes, and the following cached build also passes once you remove the variable.

### Symptom: the build compiles and generates pages, then fails on `ENOENT ... page.js.nft.json`

**Cause:** a stale or partially written `.next`. See the full entry on the Common Errors page. If it reproduces on Vercel rather than locally, force a no-cache build with the recipe above.

**Fix:** locally, `rm -rf .next` then rebuild. On Vercel, bust the build cache.

**How to confirm it worked:** the build reaches finalization and exits 0.

### Symptom: production deploys quietly stopped landing for a week while the repo looked healthy

**Cause:** a build error that only surfaces in the deployment list, not in day-to-day work. Intel's production deploys failed from 2026-07-27 to 2026-08-02 because a helper function was exported from a `route.ts` file. Next.js only permits route handler exports from a route file, so the build broke. The fix moved the function into `app/lib/zoom-ingest-run.ts`.

**Fix:**
1. Check the deployment list before assuming anything shipped:
   ```bash
   vercel inspect intel.lfiq.app --scope team_N2zeS1e4gX0Wljbp0aKwkzxb
   ```
2. If the last READY production deploy is days old, open the newest ERRORed build's log and read the compile error.
3. Move any non-handler export out of a `route.ts` file.

**How to confirm it worked:** the newest production deployment is READY and its commit SHA matches `origin/main`.

## Environment variables

### Symptom: a cross-app call 403s at the platform layer, then 401s at the application layer, and `vercel env ls` shows every required variable present

**Cause:** the variables exist but are empty. Keystone's "Run Now" sweep button hit exactly this. Both `BRICKSTON_CLOUD_RUN_INVOKER_SA_JSON` and `BRICKSTON_SCHEDULER_SECRET` were present as placeholders that never received values. `vercel env ls` shows that a variable exists. It does not show whether it has a value.

**Fix:**
```bash
vercel env pull .env.check --environment=production
awk -F= '{ print $1, length($0)-length($1)-1 }' .env.check   # name and value length
rm .env.check
```
Anything with length 0 is the bug. Copy the real value from the canonical project. Command and Registry production are the source of truth for the `BRICKSTON_*` values.

**How to confirm it worked:** the length check is nonzero for every required name, and the call returns 200 after a redeploy.

### Symptom: runtime logs show `Bad control character in string literal ... position 156` while a local `vercel env pull` parses the same variable fine

**Cause:** a service-account JSON stored with real newline characters inside `private_key` instead of two-character `\n` escapes. `JSON.parse` throws at runtime, no token is minted, and the downstream call fails with a permission error that points you at IAM. IAM was never the problem. `vercel env pull` escapes the newlines when writing the file, so the pulled copy parses and hides the fault.

**Fix:**
```bash
# validate the single-line escaped JSON locally first
node -e 'JSON.parse(require("fs").readFileSync("sa.json","utf8")); console.log("parses")'
vercel env rm BRICKSTON_CLOUD_RUN_INVOKER_SA_JSON production -y
vercel env add BRICKSTON_CLOUD_RUN_INVOKER_SA_JSON production < sa.json
# redeploy so the runtime picks it up
```
Diagnose this from runtime logs, never from a local pull. The same broken value was present on two projects at once, so check siblings after you fix one.

**How to confirm it worked:** the runtime log line that warned on the fallback branch stops appearing, and the dependent panel renders.

### Symptom: preview deploys fail on every PR while production is green

**Cause:** the environment variable is set for production only. Keystone's preview deploys fail because `DATABASE_URL` has no preview value. This is pre-existing and deliberate. There is no preview DSN on this fleet.

**Fix:** treat Keystone preview failures as expected and do not gate merges on them. If you want previews to build, add a preview-scoped value.

**How to confirm it worked:** you have checked the failing step is the missing DSN, not a real compile error, before merging.

### Symptom: `vercel env add ... preview` returns `git_branch_required` in a non-interactive shell

**Cause:** the CLI wants a branch even when you intend "all preview branches".

**Fix:** use the API instead.
```bash
curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?upsert=true&teamId=$TEAM_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"NAME","value":"...","type":"encrypted","target":["preview"]}'
```
The CLI token lives in `~/Library/Application Support/com.vercel.cli/auth.json` under the `token` key.

**How to confirm it worked:** `vercel env ls` lists the variable with a Preview target, and a fresh preview build picks it up.

### Symptom: you changed an environment variable and nothing changed

**Cause:** Vercel reads environment variables at build time. A stored value is inert until the next deploy.

**Fix:**
```bash
vercel redeploy <current-prod-url>   # takes no --prod flag
```

**How to confirm it worked:** the new deployment is READY and the behavior changed. Budget about two minutes for a build. This matters when you are coordinating a secret rotation with a system that picks up secrets instantly.

## Deploy targets and promotion

Not every repo behaves the same way on push.

| Repo | Push to main does |
|------|-------------------|
| brick.intel | Auto-deploys to production in one to two minutes |
| brick.command | Auto-deploys the monorepo apps to production |
| brick.kit | Produces a READY build with `target: null`, which is a preview, not production |

### Symptom: you pushed to main, the build is READY, and production still serves the old code

**Cause:** the project does not auto-promote. Kit is the known case.

**Fix:**
```bash
vercel promote <dpl_id> --scope team_N2zeS1e4gX0Wljbp0aKwkzxb
# or
vercel --prod
```

**How to confirm it worked:** `vercel inspect kit.lfiq.app --scope team_N2zeS1e4gX0Wljbp0aKwkzxb` shows the new deployment ID as the production alias.

### Symptom: production is serving a commit that is not on `origin/main`

**Cause:** somebody deployed with `vercel --prod` from a working tree instead of pushing. Command production served a commit while `origin/main` was two commits behind. The tell in deployment metadata is an actor of `claude-code` with no `githubDeployment` field.

**Why it matters:** "unpushed local commit" and "already live in production" can both be true. The next git-triggered build rebuilds from `origin/main` and silently rolls back the CLI-deployed work.

**Fix:** push the commit to reconcile git with production. Do not assume production is behind.

**How to confirm it worked:**
```bash
git fetch --prune
git branch -r --contains <prod_sha>   # should list origin/main
```

### Symptom: `vercel ls <project-name>` returns `Can't find the deployment`

**Cause:** the CLI treats the argument as a deployment identifier, not a project name.

**Fix:** inspect the production domain instead.
```bash
for d in hub intel command keystone registry stacks collect repair leasing risk documents utilities kit; do
  printf '%-12s ' "$d"
  vercel inspect "$d.lfiq.app" --scope team_N2zeS1e4gX0Wljbp0aKwkzxb 2>&1 | grep -m1 -i 'status'
done
```

**How to confirm it worked:** every line reports a status such as `Ready`.

## Deployments that look broken but are not

### Symptom: `intel.lfiq.app` or `keystone.lfiq.app` returns 404 at `/`

**Cause:** those apps have no root route. This is by design. Do not read it as a pause or a bad alias.

**Fix:** probe a real path.
```bash
curl -so /dev/null -w '%{http_code}\n' https://intel.lfiq.app/login
curl -so /dev/null -w '%{http_code}\n' https://intel.lfiq.app/api/health
```

**How to confirm it worked:** both return 200.

### Symptom: every path on Intel production returns 404 to an unauthenticated client

**Cause:** Intel serves a Clerk signed-out 404 rewrite at every path. A 404 carrying `x-clerk-auth-status: signed-out` means the app is serving correctly and you are not signed in.

**Fix:** check the header before escalating.
```bash
curl -sI https://intel.lfiq.app/ | grep -i x-clerk-auth-status
```

**How to confirm it worked:** the header reads `signed-out`, and the same path returns content in a browser with a session.

## Team-wide pause

### Symptom: every project on the team is `paused: true` at the same moment

**Cause:** the team spend limit tripped. A simultaneous whole-team pause is never a per-project action. This took out all 26 projects on 2026-08-07, including the brick apps and the mosser, back9, and leftfield projects.

**Fix:** unpause through the API rather than clicking 26 times.
```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/com.vercel.cli/auth.json')))['token'])")
TEAM=team_N2zeS1e4gX0Wljbp0aKwkzxb

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects?teamId=$TEAM&limit=100" \
| python3 -c "import sys,json;[print(p['id']) for p in json.load(sys.stdin)['projects'] if p.get('paused')]" \
| while read -r id; do
    curl -s -X POST -H "Authorization: Bearer $TOKEN" \
      "https://api.vercel.com/v1/projects/$id/unpause?teamId=$TEAM" > /dev/null
    echo "unpaused $id"
  done
```
Then raise or clear the limit under Settings, Billing, Spend Management. Otherwise it trips again.

**How to confirm it worked:** re-run the list step and it prints nothing.

## Related pages

- [Common Errors](/docs/common-errors)
- [Vercel Deployment](/docs/vercel-deployment)
- [Authentication Issues](/docs/auth-issues)
- [Neon Debugging](/docs/neon-debugging)
- [Architecture](/docs/architecture)
