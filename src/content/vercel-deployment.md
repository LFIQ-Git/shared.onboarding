# Vercel Deployment

Every LFIQ front end runs on Vercel under the `lfiq` team. Thirteen production apps come out of five GitHub repositories, and the deploy behavior is not uniform across them. Read the auto-deploy table before you push and assume something shipped.

## The team

| Item | Value |
|------|-------|
| Vercel team | LFIQ (slug `lfiq`) |
| GitHub organization | `LFIQ-Git` |
| Projects on the team | 26, including non-BRICK projects |
| CLI scope flag | `--scope lfiq` |

## Repository to project map

Five repositories. One of them, `brick.command`, is an npm-workspaces monorepo that produces eight separate Vercel projects, each with its own root directory.

| Repository | Vercel project | Root directory | Production URL |
|------------|----------------|----------------|----------------|
| `brick.hub` | `brick.hub` | `hub/` | https://hub.lfiq.app |
| `brick.intel` | `brick.intel` | repo root | https://intel.lfiq.app |
| `brick.keystone` | `brick.keystone` | repo root | https://keystone.lfiq.app |
| `brick.registry` | `brick.registry` | repo root | https://registry.lfiq.app |
| `brick.stacks` | `brick.stacks` | repo root | https://stacks.lfiq.app |
| `brick.command` | `brick.command` | `apps/web` | https://command.lfiq.app |
| `brick.command` | `brick.collect` | `apps/collect` | https://collect.lfiq.app |
| `brick.command` | `brick.leasing` | `apps/leasing` | https://leasing.lfiq.app |
| `brick.command` | `brick.repair` | `apps/repair` | https://repair.lfiq.app |
| `brick.command` | `brick.documents` | `apps/documents` | https://documents.lfiq.app |
| `brick.command` | `brick.utilities` | `apps/utilities` | https://utilities.lfiq.app |
| `brick.command` | `brick.civic` | `apps/civic` | https://civic.lfiq.app |
| `brick.command` | `brick.payables` | `apps/payables` | https://payables.lfiq.app |

`brick.runner` still appears in the team list. The repository was deleted 2026-07-05 and the project is inert. `runner.lfiq.app`, `cockpit.lfiq.app`, and `box.lfiq.app` do not resolve.

Intel and Keystone return 404 at `/` by design. Check `/login` or `/api/health` when you are verifying that a deploy is alive.

## Auto-deploy versus manual promote

| Project | Push to `main` behavior | How production changes |
|---------|-------------------------|------------------------|
| `brick.intel` | Builds and promotes to production automatically | Push to `main` |
| `brick.hub` | Builds and promotes to production automatically | Push to `main` |
| `brick.registry` | Builds and promotes to production automatically | Push to `main` |
| `brick.stacks` | Builds and promotes to production automatically | Push to `main` |
| `brick.keystone` | Builds and promotes to production automatically | Push to `main` |
| `brick.command` (`apps/web`) | Builds with `target: null`, meaning preview, not production | Manual `vercel promote` or `vercel --prod` |
| `brick.command` sub-apps | Build on push; promotion behavior follows the same monorepo pattern as `apps/web` | Verify in the dashboard before assuming |

Promote a Command build:

```bash
cd apps/web
vercel promote <deployment-url-or-id> --scope lfiq
# or deploy straight to production from the working tree
vercel --prod --scope lfiq
```

This creates a real hazard. Because Command production can be promoted from the CLI, production can run code that is not on `origin/main`. On 2026-07-13 Command production was serving commit `3f0ebc6` while `origin/main` sat at `78eba49`. The next git-triggered build rebuilt from `origin/main` and silently reverted the CLI-deployed work.

If you deploy Command from the CLI, push the same commit to `main` in the same sitting. No exceptions.

Stacks had the mirror-image problem until 2026-07-08: its Vercel git link pointed `productionBranch` at a dead `master`, so nothing on `main` ever promoted. If a project stops deploying for no visible reason, check the production branch setting first.

## Preview deployments

Any push to a non-`main` branch builds a preview at `https://<branch>-<project>.vercel.app`. Pull requests get a comment with the preview link.

Keystone previews always fail. `DATABASE_URL` is set only in the production environment on that project, so preview builds cannot connect. This is known and is not a merge blocker. Review Keystone changes locally.

## Environment variables

Vercel holds the runtime environment for every project. Pull it locally rather than hand-assembling a `.env.local`:

```bash
cd brick.intel
vercel link --scope lfiq          # choose the brick.intel project
vercel env pull .env.local        # writes the development environment
vercel env pull .env.local --environment=production   # when you need prod values
```

For the Command monorepo, link from the sub-app directory, not the repo root, or you will pull the wrong project's variables:

```bash
cd brick.command/apps/web && vercel link --scope lfiq && vercel env pull .env.local
cd ../repair && vercel link --scope lfiq && vercel env pull .env.local
```

Variables you will need most often, by project:

| Project | Required | Notes |
|---------|----------|-------|
| `brick.intel` | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Unpooled is for drizzle-kit only |
| `brick.keystone` | `DATABASE_URL`, `BRICK_CLERK_PUBLISHABLE_KEY`, `BRICK_CLERK_SECRET_KEY` | Must be the pooled Neon host |
| `brick.registry` | `DATABASE_URL`, `BRICK_CLERK_PUBLISHABLE_KEY`, `BRICK_CLERK_SECRET_KEY`, `CRON_SECRET` | `CRON_SECRET` gates the daily digest route |
| `brick.stacks` | `DATABASE_URL`, `BRICK_CLERK_PUBLISHABLE_KEY`, `BRICK_CLERK_SECRET_KEY` | Shares `neondb` with Intel |
| `brick.command` | `BRICKSTON_*` server-side keys | Server-side only; browser-visible values must carry the `NEXT_PUBLIC_` prefix |

Never commit `.env.local`. Never paste a value into a PR description.

## Cron routes

Vercel cron is the scheduler for anything Intel-native. `vercel.json` in each repo is the source of truth for cadence, not a wiki page.

| Repo | `vercel.json` holds |
|------|---------------------|
| `brick.intel` | 16 cron entries covering Graph pull, extraction, observations, knowledge edges, Smartsheet, plus per-function `maxDuration` |
| `brick.command` | `sync-clerk-allowlist` at `0 11 * * *`, plus the custom monorepo install command |
| `brick.registry` | notification digest at `0 14 * * *` |
| `brick.keystone` | cron entry plus security headers |

Intel cron routes authenticate through `assertIngestAuth` in `app/lib/ingest-auth.ts`. Vercel's own cron invocation is authenticated automatically; a manual call needs the ingest secret.

## Build cache poisoning

Symptom, seen on `brick.command` 2026-06-29:

```
npm error Missing: command-risk@0.1.0 from lock file
```

The package does not exist in git. `git grep command-risk` returns nothing and `npm ci --dry-run` passes locally. The cause is Vercel's per-project build cache holding a stale workspace directory that the root `"workspaces": ["apps/*"]` glob re-discovers at build time. Each new deploy inherits the poisoned cache from the last one.

The fix, in order:

```bash
cd apps/web
echo "1" | vercel env add VERCEL_FORCE_NO_BUILD_CACHE production

git commit --allow-empty -m "chore: force no-cache build"
git push origin main
# wait for that build to reach READY

vercel env rm VERCEL_FORCE_NO_BUILD_CACHE production -y
```

`vercel redeploy <url>` does not work here. It reuses the original deployment's build settings and ignores the new environment variable. The build has to be triggered by a git push.

## Other build failures worth recognizing

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ENOENT ... .next/server/app/_not-found/page.js.nft.json` | Stale local `.next` during trace collection | `rm -rf .next node_modules/.cache && npm run build` |
| React `useContext` of null, or "Objects are not valid as a React child" in a sub-app | Sub-app pinned to an older React or Next than the root | Align `next`, `react`, `react-dom` across the workspace, then `npm install` at the repo root |
| A sub-app resurrects old dependency versions after a root bump | A stray per-app `package-lock.json` | `ls apps/*/package-lock.json`, delete any hits, `npm install` at the root |
| Every Actions run becomes `startup_failure` under a blank workflow named `BuildFailed` | GitHub-side workflow registration wedge | `gh workflow disable --all && gh workflow enable --all`, then push a trivial edit to a workflow file |

npm workspaces uses a single lockfile at the repository root. A lockfile inside `apps/*` is always a bug.

## Team-wide pause on spend limit

On 2026-08-07 the team spend limit tripped and Vercel set `paused: true` on all 26 projects at once. Every site went down together. Unpausing one at a time in the dashboard is 26 clicks and tells you nothing about whether the limit will re-trip.

```bash
TOKEN=$(jq -r '.token' ~/Library/Application\ Support/com.vercel.cli/auth.json)

# list projects and their pause state
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects?slug=lfiq&limit=100" \
  | jq '.projects[] | {id, name, paused}' > /tmp/projects.json

# unpause every paused project
jq -r '.projects[] | select(.paused == true) | .id' /tmp/projects.json | while read -r PID; do
  curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    "https://api.vercel.com/v1/projects/$PID/unpause?slug=lfiq" > /dev/null
  echo "unpaused $PID"
done

# confirm zero remaining
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects?slug=lfiq&limit=100" \
  | jq '[.projects[] | select(.paused == true)] | length'
```

Unpausing does not fix the cause. Raise or clear the limit under Settings, Billing, Spend Management, or it will pause everything again on the next billing tick.

## CI gates

GitHub Actions runs typecheck on every repo before merge. Lint is deliberately excluded on Registry, which carries roughly 285 outstanding eslint errors.

| Repo | Workflow checks |
|------|-----------------|
| `brick.command` | Typecheck across all sub-apps |
| `brick.registry` | Typecheck; lint present but not gating |
| `brick.intel` | Typecheck plus unit tests, excluding `*.int.test.ts` |
| `brick.keystone` | Typecheck plus tests |

Intel and Keystone depend on private `github:LFIQ-Git/*` npm packages, and organization policy disables deploy keys. Both use a fine-grained PAT stored as the repo secret `GH_PAT` with read-only Contents access to `brick-backend-forward` and `canonical-llm`:

```yaml
- name: Authorize private git deps
  run: git config --global url."https://${GH_PAT}@github.com/".insteadOf "https://github.com/"
  env:
    GH_PAT: ${{ secrets.GH_PAT }}

- uses: actions/checkout@v4
  with:
    persist-credentials: false

- run: npm ci
```

`persist-credentials: false` is load-bearing. Without it, `actions/checkout` writes the repo-scoped `GITHUB_TOKEN` into `.git/config` as an `http.extraheader`, which overrides the URL rewrite and makes every private dependency 404.

## Checking deploy status from the terminal

`vercel ls <project-name>` does not work as you would expect; it treats the argument as a deployment ID and errors with "Can't find the deployment". Use `inspect` against the production domain instead:

```bash
vercel inspect command.lfiq.app --scope lfiq | grep -i status
vercel logs command.lfiq.app --scope lfiq
```

## Where to get help

- [Architecture](/docs/architecture) for how the apps relate to each other
- [Vercel Debugging](/docs/vercel-debugging) for build and runtime failures
- [Neon Database](/docs/neon-database) for the connection strings these projects need
- [Clerk Authentication](/docs/clerk-auth) for the auth environment variables
- Justin owns the Vercel team and the spend limit. Ask before adding a project.
