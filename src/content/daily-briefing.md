# Daily Briefing Generation

Two different things in this platform are called a briefing. One is a written morning digest of tasks, calendar, and commitments, stored in Neon and served to any agent client. The other is a generated audio or video recap of the observation inbox, stored in the artifact library. They share a name and nothing else. Know which one someone means before you go debugging.

## The two briefings

| | Written daily briefing | Brick audio and video briefing |
|---|---|---|
| Producer | `brick.keystone/automation/scripts/daily_briefing.py` | `brick.command/backend/scripts/brick_briefing.py` |
| Reads | PKM tasks, deadlines, commitments, delegated items, calendar, watchlist, audit and extraction history | `items.inbox_items` for a time window, scoped to items tied to an active portfolio property |
| Output | Markdown text | Audio file, or video for the weekly recap |
| Stored in | `public.daily_briefing` | `portfolio.ai_artifact`, file in object storage |
| Delivered by | `get_briefing` MCP tool | Artifact library, `GET /api/v1/artifacts` |
| Scheduled | See "Scheduling reality" below | Fly `brick-cron`, three labels |

## Track 1: the written daily briefing

### Storage

One row per day.

```sql
-- migration 021_daily_briefing.sql
public.daily_briefing (
  briefing_date  date PRIMARY KEY,
  content        text,
  generated_at   timestamptz
)
```

The runtime `pkm` role holds SELECT, INSERT, UPDATE, and DELETE. DDL against `public` has to run as `neondb_owner`, because the `pkm` role has no CREATE there.

### Pipeline

| Stage | What runs | Detail |
|-------|-----------|--------|
| 1. Collect | `get_priority_tasks`, `get_approaching_deadlines`, `get_changes_since_yesterday`, `get_commitments`, `get_delegated_tasks`, `get_calendar_text`, `get_possible_completions`, `get_system_status`, `get_watchlist_summary`, `get_recent_audit`, `get_extraction_history` | Each is a direct query through `lib.database` |
| 2. Compose | `build_briefing_with_ai()` loads the prompt at `automation/config/prompts/execution/daily_briefing.md` and calls the configured LLM provider | `--no-llm` switches to `build_briefing_without_ai()`, a pure template render with no model call |
| 3. Write file | `write_briefing()` writes `ACTIVE/PKM/daily/<YYYY-MM-DD>.md` atomically through a temp file and rename | Wrapped in a try/except. A missing SSD is expected and logged as a warning, not a failure |
| 4. Write database | `write_briefing_to_db()` upserts into `public.daily_briefing` on the `briefing_date` conflict | This is the step that matters. The file is an optional local copy |
| 5. Serve | `get_briefing` MCP tool | Reads Neon first, falls back to the local file |

The database write is deliberately last and independent of the file write, so a machine with no SSD mounted still produces a usable briefing.

### The two get_briefing implementations

This has cost a redeploy before. There are two, and editing the wrong one changes nothing.

| Implementation | File | Exposed as |
|----------------|------|------------|
| Keystone | `brick.keystone/automation/mcp_server.py`, `get_briefing()` | The Keystone MCP server |
| Hub shim | `brick.hub/packages/brick-agent-mcp/brick_agent_mcp/server.py`, `_get_briefing()` | The `get_briefing` tool on the Brick MCP server |

Both read `public.daily_briefing` first. The tell that you are hitting the Hub shim is its empty-state string. If a briefing exists in Neon but a client returns nothing, you patched the wrong copy.

### Regenerating

```bash
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.keystone

# Today, with the LLM composer
./venv/bin/python -m automation.scripts.daily_briefing

# A specific date
./venv/bin/python automation/scripts/daily_briefing.py --date 2026-08-11

# Template only, no model call. Use this to isolate an LLM provider failure
./venv/bin/python automation/scripts/daily_briefing.py --no-llm

# Print without writing anywhere
./venv/bin/python automation/scripts/daily_briefing.py --dry-run
```

A fresh clone has no Python environment. Create `venv` and install `automation/requirements.txt` before running these commands, then confirm the imports resolve before treating an import error as a code bug.

Verify the write landed:

```sql
SELECT briefing_date, generated_at, length(content) AS chars
FROM public.daily_briefing
ORDER BY briefing_date DESC
LIMIT 7;
```

### Debugging a missing briefing

| Symptom | Check | Fix |
|---------|-------|-----|
| `get_briefing` returns empty, row exists in Neon | Which implementation the client is bound to | Patch and redeploy the correct shim |
| No row for today | Nothing ran. See "Scheduling reality" | Run the script manually |
| Row exists but content is a bare template | LLM provider call failed and the code fell through | Run with `--no-llm` to confirm the data layer, then check the provider credential |
| Script errors on the file write only | SSD not mounted | Ignore. The database write is separate and still runs |
| Query hangs then times out | Neon cold start | Issue a `SELECT 1`, then rerun |

## Scheduling reality

The written briefing used to run from a local scheduled job on the operator's Mac at 06:00. **That job was retired on 2026-06-23** along with the rest of the local job fleet, and its definition sits in `brick.keystone/automation/launchd/retired/`. No `com.justinsato.*` jobs are loaded on the machine.

There is no replacement producer in the Fly `brick-cron` crontab, in any Worker cron trigger (the `brick-keystone` Worker's only cron is `5 8 * * *` for `/api/cron/carry-score`), or in the Command job registry. As written today, the daily briefing table is populated by an on-demand run: the MCP automation runner whitelists the script, and an operator or agent can invoke it directly. **Not verified: whether any scheduler now fires it on a cadence. Confirm with Justin before telling anyone the written briefing runs automatically every morning.**

A separate agent task named `daily-primer` produces a morning primer under `PKM/primers/`. That is a different artifact from `public.daily_briefing`, and its own step-zero instructions still reference the retired local jobs and a pre-rename PKM path, so treat that skill file as out of date.

## Track 2: the Brick audio and video briefing

### Schedule

These run on Fly `brick-cron`, container timezone America/Los_Angeles, so the times below are Pacific.

| Label | Cron | Command |
|-------|------|---------|
| `briefing-daily-audio` | `0 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience confidential --out-dir /tmp/briefings` |
| `briefing-daily-public` | `15 7 * * *` | `python -m scripts.brick_briefing --kinds audio --window-hours 24 --audience public --out-dir /tmp/briefings` |
| `briefing-weekly-soap` | `0 8 * * 1` | `python -m scripts.brick_briefing --kinds video --soap --window-hours 168 --out-dir /tmp/briefings` |

The 15-minute offset between the two daily runs is deliberate. Each audience owns a distinct generation notebook, and the offset keeps concurrent runs from colliding on the account.

### Audiences

Audience is an allow-list over `items.inbox_items` sources, not a post-hoc redaction. A source not named in the audience never enters the document.

| Audience | Scope | Sources read item by item | Sources counted only |
|----------|-------|---------------------------|----------------------|
| `confidential` | `confidential` | Personal email and calendar for both tenants, meeting notes, AR and collections, notice to vacate, code violations, documents | Market listings, market news, Craigslist, SF open data |
| `public` | `public` | Code violations, market news | Market listings, Craigslist, SF open data |

The confidential audience carries resident-level AR and notice-to-vacate detail, so it is owner-gated. The owner email is environment-overridable through `BRIEFINGS_CONFIDENTIAL_OWNER`.

### Pipeline

1. Query `items.inbox_items` for the window, joined to active portfolio properties. The active-property filter spans the `items` and `portfolio` schemas, which is why the job needs the Command DSN rather than the Intel one.
2. Compose a single briefing document from the audience's focus and count-only source sets, capped at 45 focus items.
3. Write the document into the audience's notebook and request the artifact: audio for daily, video for the weekly recap.
4. Download the finished file to the output directory.
5. Register it with `record_artifact()`, which uploads the file and inserts a `portfolio.ai_artifact` row with `producer='briefings'`, the audience scope as `visibility`, and `owner_email` for the confidential scope.

Registration archives the prior artifact in the same kind, scope, and owner slot rather than deleting it. The library shows exactly one current item per slot; everything else moves to the archive view and stays downloadable by id.

### Reading

`GET /api/v1/artifacts` on the Command backend. Every read path filters confidential rows against the caller's email:

```sql
-- the gate applied on every artifact read
a.visibility <> 'confidential' OR lower(a.owner_email) = $1
```

A non-owner requesting a confidential artifact by id gets a not-found, not a forbidden. Telling a stranger that a confidential artifact exists is itself a leak.

### Regenerating

```bash
# Re-run a briefing label on Fly
flyctl ssh console -a brick-cron -C \
  "/app/run-job.sh briefing-daily-public python -m scripts.brick_briefing \
   --kinds audio --window-hours 24 --audience public --out-dir /tmp/briefings"

# Locally, needs the Command DSN and the generation credential
cd /Volumes/minibase/justinsato/Projects/ACTIVE/apps/brick/brick.command/backend
./venv/bin/python -m scripts.brick_briefing --kinds audio --window-hours 48
```

The `--kinds` flag also accepts `mindmap`, `infographic`, and `slides`. Those are not on a schedule.

Verify a run landed:

```sql
SELECT kind, title, visibility, status, created_at, size_bytes
FROM portfolio.ai_artifact
WHERE producer = 'briefings'
ORDER BY created_at DESC
LIMIT 10;
```

### Debugging a missing audio or video

| Symptom | Cause | Action |
|---------|-------|--------|
| No new artifact row, job exited clean | Generation returned no artifact. The script is best-effort and off the critical path, so it logs and exits rather than failing loudly | Read the Fly job log for the label |
| Artifact row exists but nobody can see it | Confidential scope and the viewer email does not match `owner_email` | Confirm the viewer, or regenerate under the public audience |
| Both daily runs produced the same content | The two audiences share a notebook | Verify the audience definitions still resolve to distinct notebooks |
| Job never started | `brick-cron` dispatcher down | Check the dispatcher liveness endpoint and the dead-man's-switch monitor app |
| Weekly video empty | 168-hour window with no qualifying inbox items | Confirm ingestion for that week first |

The Command job registry (`backend/app/jobs/registry.py`) no longer carries briefing entries. The three `brick-cron` crontab labels above are the only schedule.

## Related pages

- [Keystone](/docs/apps/keystone)
- [Command](/docs/apps/command)
- [Intel](/docs/apps/intel)
- [Hub](/docs/apps/hub)
- [Data Ingestion](/docs/data-ingestion)
- [Architecture Overview](/docs/architecture)
- [Fly.io Backend](/docs/fly-io-backend)
