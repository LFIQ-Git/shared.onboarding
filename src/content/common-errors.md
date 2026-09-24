# Common Errors

Cross-cutting failures the LFIQ team has actually hit, with the fix that worked. Vendor-specific problems live on the Neon, Vercel, and auth pages. Start here when you do not yet know which layer broke.

## Triage table

| What you see | Go to |
|--------------|-------|
| Submodule directory is empty, edits do nothing | [Repo layout and worktrees](#repo-layout-and-worktrees) |
| You changed the app switcher and only one app updated | [Repo layout and worktrees](#repo-layout-and-worktrees) |
| `Cannot read properties of null (useContext)` in a Command sub-app | [Dependencies and lockfiles](#dependencies-and-lockfiles) |
| `npm ci` pulls React 18 into a workspace that should be on 19 | [Dependencies and lockfiles](#dependencies-and-lockfiles) |
| `ENOENT ... page.js.nft.json` at "Collecting build traces" | [Local builds and dev servers](#local-builds-and-dev-servers) |
| `npm run lint` hangs asking Strict / Base / Cancel | [Local builds and dev servers](#local-builds-and-dev-servers) |
| Dev server throws ENOENT on `route.js` | [Local builds and dev servers](#local-builds-and-dev-servers) |
| Every GitHub Actions run is `startup_failure` | [CI failures](#ci-failures) |
| `npm ci` 404s on a `github:LFIQ-Git/*` dependency in CI | [CI failures](#ci-failures) |
| `metadata->>'key'` returns null after a successful update | [Data-layer gotchas](#data-layer-gotchas) |
| `42P18 indeterminate datatype` | [Data-layer gotchas](#data-layer-gotchas) |
| `Objects are not valid as a React child` on one detail page | [Data-layer gotchas](#data-layer-gotchas) |
| `invalid input syntax for type timestamp` reading calendar rows | [Data-layer gotchas](#data-layer-gotchas) |
| The same observation appears two to four times | [Duplicate records](#duplicate-records) |
| A fleet sweep reports branches as in-flight that were merged | [Git hygiene](#git-hygiene) |

## Repo layout and worktrees

The canonical checkouts are `brick.apps/02-brick.{command,hub,intel,keystone,registry}`. `brick.apps` is a git superproject that tracks each app as a submodule gitlink and has its own remote at `LFIQ-Git/brick.apps`.

### Symptom: you edit a file under `brick.apps/.claude/worktrees/<name>/brick.hub/` and nothing changes

**Cause:** worktrees created off the superproject have empty submodule directories. You are editing a path that carries no code.

**Fix:**
1. Edit the real checkout instead:
   ```bash
   cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.hub
   ```
2. If you need an isolated copy, add a worktree inside the child repo off `origin/main`, not off the superproject.
3. Symlink `node_modules` from the main checkout when the lockfile matches, rather than reinstalling.

**How to confirm it worked:** `git -C <path> status` inside the directory you are editing returns a real repo with tracked files, not an empty tree.

### Symptom: a fleet-wide nav or branding change only lands in one app

**Cause:** `AppFamilyMenu` is a hand-copied file per app, not a shared import. Only the Command monorepo shares one copy across its sub-apps.

**Fix:** edit every copy.

| App | Path |
|-----|------|
| Command (shared across sub-apps) | `brick.command/packages/ui/src/components/app-family-menu.tsx` |
| Intel | `brick.intel/app/components/AppFamilyMenu.tsx` |
| Registry | `brick.registry/components/AppFamilyMenu.tsx` |
| Stacks | `brick.stacks/components/AppFamilyMenu.tsx` |
| Keystone | `brick.keystone/components/AppFamilyMenu.tsx` |
| Hub | `brick.hub/hub/components/AppFamilyMenu.tsx` |

Hub also draws the tagline strip from `brick.hub/hub/lib/apps.ts` (`BRICK_APPS_BRICK_ORDER`), which uses its own wording. A tagline sweep touches that file plus the reference copy at `brick.hub/canonical-app-family-menu/AppFamilyMenu.tsx`.

**How to confirm it worked:** grep both string sets across `brick.apps/` and get zero stale hits.

## Dependencies and lockfiles

### Symptom: `Cannot read properties of null (useContext)` or `Objects are not valid as a React child (… _owner)` from a Command sub-app server render

**Cause:** a React version split inside the monorepo. React 19 hoists to the root `node_modules` while a sub-app pins React 18, and a React-18-shaped element reaches the React 19 renderer. This broke every production build of all six Command sub-apps until the versions were unified.

**Fix:**
1. Pin every sub-app to mirror `apps/web`: `next ^15.5.9`, `react` and `react-dom` `^19.0.3`, `eslint-config-next ^15.5.9`.
2. Delete any per-app lockfile and regenerate the single root one.
3. Run the async-request-api codemod where params and searchParams are now Promises:
   ```bash
   npx @next/codemod@latest next-async-request-api apps/collect apps/repair apps/leasing apps/utilities
   ```

**How to confirm it worked:** `npm run build -w command-<app>` succeeds for each sub-app (`apps/web` is workspace `web`, not `command-web`).

### Symptom: a sub-app build fails on a dependency mismatch that is not in the root lockfile

**Cause:** a committed per-app `package-lock.json`. npm workspaces uses one root lockfile; a stray per-app lockfile poisons resolution locally and poisons Vercel's per-app install.

**Fix:**
```bash
cd brick.apps/brick.command
ls apps/*/package-lock.json          # any hit here is the bug
git rm apps/<name>/package-lock.json
rm -rf apps/<name>/node_modules
npm install                          # from the repo root only
```

**How to confirm it worked:** `ls apps/*/package-lock.json` returns nothing and `npm ci` from the repo root passes.

### Symptom: `npm ci` fails in CI but passes locally on the same lockfile

**Cause:** the lockfile was generated by a newer npm than the CI runner's Node ships. Keystone hit this; the lockfile had to be regenerated with npm 10 so `npm ci` would run on Node 20 runners.

**Fix:**
```bash
npm install -g npm@10
rm package-lock.json
npm install
git commit -am "chore: regenerate lockfile with npm@10"
```

**How to confirm it worked:** the CI `npm ci` step passes on the runner, not just locally.

## Local builds and dev servers

### Symptom: `ENOENT: no such file or directory, open '.../.next/server/app/_not-found/page.js.nft.json'`

**Cause:** `next build` compiles and generates static pages, then fails at "Collecting build traces" because `.next` is stale or partially written. Seen on Command web on the external SSD volume.

**Fix:**
```bash
cd brick.apps/brick.command/apps/web
rm -rf .next
npm run build
# if it recurs
rm -rf node_modules/.cache && npm run build
```

**How to confirm it worked:** the build reaches "Finalizing page optimization" and exits 0.

### Symptom: the dev server throws ENOENT on `route.js` and pages will not hydrate

**Cause:** two `next dev` processes running against the same checkout. They fight over `.next`.

**Fix:**
```bash
pkill -f "next dev"
rm -rf .next
npm run dev
```

One dev server per checkout. If you need two, use two checkouts.

**How to confirm it worked:** the dev server boots clean and pages render past the streaming placeholder.

### Symptom: `npm run lint` opens an interactive Strict / Base / Cancel prompt and blocks

**Cause:** the script is bare `next lint` with no committed ESLint config in the tree, so Next.js runs its interactive setup. Non-interactive runs and headless agents hang here.

**Fix:** do not gate CI or scripted work on `npm run lint` in a repo with no ESLint config. Use the typecheck and test gates instead, or commit an ESLint config first.

**How to confirm it worked:** the command exits without waiting on stdin.

## CI failures

### Symptom: every push, PR, and schedule run becomes `startup_failure` under a blank-named workflow

**Cause:** a GitHub-side registration wedge. A ghost workflow with a blank name, path `BuildFailed`, and state `deleted` swallows all triggers. `workflow_dispatch` runs still work and every YAML on main parses clean, which is what makes it confusing. Seen on Command for three days; Hub and Intel got it and self-recovered after one run.

**Fix:**
1. Confirm the diagnosis:
   ```bash
   gh api repos/LFIQ-Git/brick.command/actions/runs/<run_id> -q .workflow_id
   gh api repos/LFIQ-Git/brick.command/actions/workflows/<that_id> -q '{path:.path,state:.state}'
   ```
   A `path: BuildFailed, state: deleted` result is the ghost.
2. Cycle every workflow and force a re-parse:
   ```bash
   gh workflow list --repo LFIQ-Git/brick.command
   gh workflow disable <name> --repo LFIQ-Git/brick.command
   gh workflow enable  <name> --repo LFIQ-Git/brick.command
   ```
3. Push a trivial change to a workflow file, for example adding `workflow_dispatch` to `ci.yml`.

**How to confirm it worked:** the next push-triggered run appears under a real workflow name and runs to completion.

### Symptom: `npm ci` in CI 404s on a private `github:LFIQ-Git/*` dependency while `gh api` on the same repo works

**Cause:** `actions/checkout` stores the repo-scoped `GITHUB_TOKEN` as `http.extraheader` in the workspace git config. That header overrides URL credentials on every github.com request from the workspace, so a PAT rewritten into the dependency URL is ignored. API calls succeed and git calls fail, which is the signature.

**Fix:**
1. Set a fine-grained `GH_PAT` repo secret with read-only Contents on the private dependency repos.
2. In the workflow, check out with credentials disabled, then rewrite the URLs:
   ```yaml
   - uses: actions/checkout@v4
     with:
       persist-credentials: false
   - name: Authorize private git deps
     run: git config --global url."https://${{ secrets.GH_PAT }}@github.com/LFIQ-Git/".insteadOf "https://github.com/LFIQ-Git/"
   - run: npm ci
   ```

Org-wide deploy keys are disabled, so SSH deploy keys are not an option for new repos.

**How to confirm it worked:** the `npm ci` step resolves the private dependency and the job proceeds to typecheck.

## Data-layer gotchas

### Symptom: an update reports success but `metadata->>'yourkey'` returns null, and `jsonb_typeof(metadata)` is `array`

**Cause:** double-encoded JSON. In postgres.js, `` sql`... || ${JSON.stringify(obj)}::jsonb` `` serializes the already-serialized string a second time, producing a jsonb string scalar. Concatenating an object with a string scalar makes Postgres build an array. The Command backend has the same bug through asyncpg because `app/db.py` registers `json.dumps` as the jsonb encoder on every pool, so passing `json.dumps(obj)` double-encodes there too. This caused a live data-corruption incident and a second recurrence three weeks later, and the eventual sweep repaired more than 37,000 rows.

**Fix:**
1. Pass raw objects and dicts, never pre-stringified JSON:
   ```ts
   // postgres.js
   await sql`update items.tasks set metadata = metadata || ${obj as never}::jsonb where id = ${id}`;
   ```
   ```sql
   -- or build it server-side from scalars only
   jsonb_build_object('project', $1::text, 'units', $2::int)
   ```
2. In the Command backend on asyncpg pools, dicts in and dicts out. `json.dumps` before a `::jsonb` param is always wrong there. Scripts and jobs on raw `asyncpg.connect` have no codec registered, so those do require pre-stringifying.
3. Repair existing damage:
   ```sql
   -- string scalars
   UPDATE portfolio.<table> SET col = (col #>> '{}')::jsonb WHERE jsonb_typeof(col) = 'string';
   -- single-element arrays where the original was an object
   UPDATE items.tasks SET metadata = metadata->0 WHERE jsonb_typeof(metadata) = 'array';
   ```

**How to confirm it worked:** the detection query returns zero.
```sql
SELECT count(*) FROM items.tasks
WHERE metadata IS NOT NULL AND jsonb_typeof(metadata) <> 'object';
SELECT count(*) FROM public.agent_actions WHERE jsonb_typeof(payload) = 'string';
```
The Brick sweep runs this assertion after every run and posts a data-corruption item to `public.agent_feed` when it is nonzero. Any new metadata-merge write should carry a test asserting `jsonb_typeof(metadata) = 'object'`.

### Symptom: `42P18 indeterminate datatype`

**Cause:** an empty JS array interpolated into a typed cast, for example `${[]}::uuid[]`. Postgres cannot infer the type.

**Fix:** guard the empty case and skip the column or the clause entirely rather than passing an empty array.

**How to confirm it worked:** the query runs with an empty input set and returns zero rows instead of erroring.

### Symptom: one detail page 500s while every other row renders

**Cause:** two separate patterns, both seen on Keystone `/tasks/[id]`.

1. A `sql` fragment interpolating a JS array, `` sql`${entities.id} = ANY(${row.entityIds}::uuid[])` ``, throws at query time once `entity_ids` is populated.
2. A jsonb `metadata.comments` element whose `author` or `text` is an object gets rendered into JSX, and React Server Components throw `Objects are not valid as a React child`.

**Fix:**
1. Use the typed builder: `inArray(entities.id, row.entityIds)`.
2. Normalize comment fields to strings, or substitute a placeholder, before render.

**How to confirm it worked:** load the specific failing id, not just the list page. In production, the browser console error digest is the lookup key in Vercel logs for the real stack trace.

### Symptom: `invalid input syntax for type timestamp` reading calendar rows, followed by an unrelated-looking module error

**Cause:** Microsoft Graph nests `start` and `end` as `{"dateTime": ..., "timeZone": ...}` objects. `(payload->>'start')::timestamptz` extracts the whole object as text. The exception was swallowed and execution fell through to a retired local fallback, so the surfaced error was two layers below the real cause.

**Fix:** extract the inner field before casting.
```sql
SELECT payload->'start'->>'dateTime' AS starts_at
FROM items.inbox_items
WHERE source IN ('m365-lfi-calendar', 'm365-mosser-calendar')
ORDER BY (payload->'start'->>'dateTime')::timestamptz DESC;
```
Flatten `start`, `end`, `organizer`, and `location` in the result mapping too. `location` can be a string or an object with `displayName`.

**How to confirm it worked:** the query returns real events with parseable timestamps.

## Duplicate records

### Symptom: the same observation repeats two to four times, for example one property and dollar amount appearing three times in a day's promotions

**Cause:** a self-perpetuating import loop between Intel and Command, live since the single-database consolidation. Command wrote an observation to `items.observations`. Intel's cron drained rows where `pushed_to_brickston_at IS NULL` and posted each to Command's receiver, which inserted a new row into the same table with `pushed_to_brickston_at` null again. Each clone carried `dedupe_key = items_hub:<previous row id>`, a visible chain. Roughly 530 real signals became about 17,000 rows.

**Fix (already shipped, command #161 and intel #35):** the receiver skips when `id = items_hub_id`, and the push drain query excludes rows whose metadata already carries an `items_hub_id`. Either guard alone breaks the loop.

**How to confirm it worked:** check for a chain.
```sql
SELECT count(*) FROM items.observations
WHERE metadata->>'dedupe_key' LIKE 'items_hub:%';
```
A growing count means the loop regressed, usually from a reverted PR or a new push path. The dedup belongs in the generator or the receiver, never in the promoter's SELECT.

## Git hygiene

### Symptom: a fleet sweep reports branches as active work in progress that were merged days ago

**Cause:** the sweep script defaults to `NO_FETCH=1` and classifies branches against the last known local `origin/main`. Stale remote refs manufacture phantom in-flight work. One run reported 11 active branches; after fetching, 10 were already merged or superseded.

**Fix:**
```bash
for d in /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.apps/02-brick.*; do
  git -C "$d" fetch --quiet --prune
done
```
Then re-test each branch against fetched `origin/main`:
```bash
changed=$(git diff --name-only origin/main...<branch>)
git diff --quiet origin/main <branch> -- $changed && echo "superseded"
```

**How to confirm it worked:** compare against `origin/main`, not local `main`, and the active-branch count drops to the branches that hold real unlanded work.

## Related pages

- [Neon Debugging](/docs/neon-debugging)
- [Vercel Debugging](/docs/vercel-debugging)
- [Authentication Issues](/docs/auth-issues)
- [Architecture](/docs/architecture)
- [Local Setup](/docs/getting-started/setup)
