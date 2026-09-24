# Deal Sourcing Workflow

How an SF multifamily acquisition candidate goes from a raw assessor parcel record to a scored opportunity, to a dossier an analyst can act on, to a live deal in Registry. The app that runs this is Stacks. Everything is keyed on the San Francisco parcel number.

## The identifier

**APN, the SF block-and-lot parcel number, is the key for the entire external pipeline.** Not address, not property name, not a vendor record id. Addresses in San Francisco are unreliable for matching because of corner lots, address ranges, and buildings that span parcels. The APN is stable.

| Table | Key | Holds |
|-------|-----|-------|
| `stacks.parcels` | `apn` (PK) | The parcel universe: address, coordinates, use code, units, year built, owner name and mailing, last sale, assessed value, neighborhood |
| `stacks.signals` | `(apn, type, source, event_date)` unique | One row per public-record event, raw record in a `payload` jsonb |
| `stacks.candidates` | `apn` unique | Score, `score_factors` jsonb, pitch, status, assignee, `deal_id` |
| `stacks.candidate_notes` | `candidate_id` | Analyst notes |
| `stacks.parcel_info` | `apn` (PK) | SF Planning enrichment: zoning, height and bulk, historic, hazards, supervisor district |
| `stacks.portfolio_parcels` | `(property_id, apn)` | Links an owned property to its parcels |
| `stacks.source_runs` | `id` | Per-adapter run telemetry |

Contrast this with Registry's `registry.deal_candidates`, which tracks **internal** portfolio moves on assets already owned and is keyed on `property_code` against `gdm.property`. Different table, different key, different question. Stacks is external buys only.

## Pipeline stages

### 1. Seed the universe

The DataSF assessor secured roll adapter (`lib/sources/datasf-assessor.ts`) pulls SF parcels and filters to buildings of five units or more. Each parcel becomes a `stacks.parcels` row. The PropertyRadar adapter also self-seeds any parcel it returns that is not already in the roll, so a bought record never drops on the floor.

The roster page at `/properties` is the editable view over this universe. Analyst edits live in `stacks.parcel_overrides` and extra addresses in `stacks.parcel_addresses`, and the effective value is `COALESCE(override, base)`. The nightly sync only writes `stacks.parcels`, so edits survive re-ingest.

### 2. Attach signals

Free adapters run nightly and write one `stacks.signals` row per public-record event.

| Adapter | Signal type | Source |
|---------|-------------|--------|
| `datasf-permits` | `permit` | DBI building permits |
| `datasf-code` | `code` | DBI code-enforcement complaints |
| `datasf-violations` | `violation` | DBI notices of violation |
| `datasf-evictions` | `eviction`, `ellis` | Rent Board eviction notices |
| `datasf-fire` | `fire` | SFFD incidents |
| `datasf-energy` | `energy` | Energy ordinance benchmark violations |
| `datasf-softstory` | `soft_story` | Mandatory seismic retrofit status |
| `datasf-tax` | none | Documented no-op, no free SF bulk feed |
| `recorder-nod` | none | Documented no-op, no free bulk feed |

Complaints and violations are deliberately kept separate. Complaints are the superset, violations are the escalated subset. Merging them double-counts distress.

### 3. Buy the distress data the city does not publish

Tax delinquency, real mortgage records, and pre-foreclosure do not exist as a free SF bulk feed. Those come from PropertyRadar, with DataTree as a second paid source.

| Provider | What it adds | Billing model |
|----------|--------------|---------------|
| PropertyRadar | Mortgage records, pre-foreclosure, life-event triggers, a 0-100 composite DistressScore, owner contacts | Monthly included export credits plus a pay-as-you-go balance, charged per record returned |
| DataTree (First American) | Farm search per distress dimension | Per record |

**Paid pulls never run on a schedule.** `freeAdapters()` in `lib/sources/index.ts` filters the paid keys out, and the nightly cron calls that function. Every paid adapter is additionally gated behind an operator toggle in `stacks.app_settings` (`propertyradar_purchase`, `append_contacts`, `pr_monitor_ingest`, `owner_enrich_cron`, `datatree_purchase`), managed at `/admin/purchasing`. A row in `app_settings` overrides the environment default; no row and the environment default stands.

Two billing rules a new analyst has to internalize before touching the purchasing screen:

- Every property **returned** with a purchase flag counts as an export and is non-refundable. Re-pulling a record you already own still burns quota.
- The API only reports the free monthly meter. It does not report the dollar balance. Never quote the free counter as the ceiling when a top-up has been purchased.

Local development shares the same Neon `app_settings` as production. A toggle flipped on a laptop is live everywhere.

### 4. Score

`lib/scoring/` composes six weighted factors that sum to 100, so the composite is already a 0-100 score. The sum is pinned by a test.

| Factor | Weight | Reads |
|--------|-------:|-------|
| `distress` | 25 | Weighted signal types, saturating |
| `tenure` | 20 | Years since last sale |
| `loan_maturity` | 20 | Estimated maturity from mortgage origination |
| `rent_upside` | 20 | Rent Board building match, or an estimate from year built and last sale |
| `neighborhood` | 10 | Neighborhood momentum |
| `size` | 5 | Unit count |

Distress is a weighted sum over signal types divided by a saturation cap. Notice of default carries the highest per-signal weight, then probate and bankruptcy, then tax delinquency, down through code complaints and evictions. A code complaint's weight is multiplied by how far DBI escalated it, from a City Attorney referral at the top down to an abated complaint at the bottom.

PropertyRadar's own DistressScore is applied as a **floor** on the distress factor, taken as a max rather than added. PropertyRadar sees liens, judgments, and probate that the free feeds do not expose, so its composite should raise a thin record but never double-count the foreclosure and tax signals already scored.

Scoring writes to `stacks.candidates` as an idempotent upsert that preserves analyst-owned fields (status, assignee, notes). Re-scoring is safe.

### 5. Filter to the buy box

The buy box is stored as JSON under the `buy_box` key in `stacks.app_settings` and edited at `/admin/buy-box` with live admit counts. It gates **surfacing only**. Scoring stays universal, so a parcel outside the box still carries a real score and can be found by APN. Append `?buybox=off` to a pipeline view to bypass it. Saved neighborhood subsets live under the `neighborhood_presets` key.

### 6. Dossier

`/candidate/[apn]` is the drill-down. When someone says "the registry property page," they mean this page, not the Registry deals app.

| Panel | Backed by |
|-------|-----------|
| Signal timeline | `stacks.signals`, each record expands to its full payload with a DBI deep link when a permit or complaint number is present |
| Planning and hazards | `stacks.parcel_info` from the SF Planning ArcGIS service |
| Map | Leaflet over OpenStreetMap tiles |
| Building photo | Mapillary, gated on `MAPILLARY_TOKEN`. Unset means map only |
| Comps | `market.listings_current`, neighborhood and rent bands |
| Portfolio performance | Only for owned parcels, proxied live from the Command backend |

The owned-property overlay resolves `property_id` through `stacks.portfolio_parcels` and calls the Command **metrics** endpoint, not the bare property record. The bare record has no occupancy or rent data. Two unit conventions to respect: occupancy comes back as a percent, not a fraction, and average upside is a per-unit dollar delta, not a percentage.

### 7. Graduate into Registry

Marking a candidate as pursued runs `pursueCandidate()` in `lib/candidates.ts` inside a transaction. It inserts a `registry.deals` row with `type='acquisition'` and `status='pipeline'`, then sets the candidate to `graduated` with the new `deal_id`. It is idempotent: if the candidate already has a `deal_id`, it returns that id and inserts nothing. From that point the deal is tracked in Registry and Stacks is a source of record for provenance only.

Candidate status values are constrained in the schema: `open`, `watch`, `pursuing`, `graduated`, `dismissed`. Default pipeline views hide `dismissed` and `graduated`.

## Schedule

All Stacks crons are in `brick.stacks/vercel.json`, UTC.

| Route | Cron | Purpose |
|-------|------|---------|
| `/api/cron/rent-board` | `30 7 * * *` | Rent Board housing inventory sync |
| `/api/cron/ingest` | `0 8 * * *` | Free-adapter ingest, address and coordinate backfill, full re-score, blurb refresh |
| `/api/cron/owner-enrich` | `30 8 * * *` | Owner enrichment (gated) |
| `/api/cron/attribute-competitors` | `0 9 * * *` | Competitor attribution |
| `/api/cron/sfbiz-attribute` | `30 9 * * *` | Business registration attribution |
| `/api/cron/manager-scrape` | `0 10 * * *` | Property manager discovery |
| `/api/cron/monitor` | `45 10 * * *` | Monitoring diff |
| `/api/cron/competitor-study` | `45 11 * * 1` | Weekly competitor study |

## Verification

```bash
# Re-score the loaded universe without re-pulling any source
curl -s "https://stacks.lfiq.app/api/cron/ingest?rescore_only=1" \
  -H "X-Cron-Secret: $STACKS_CRON_SECRET" | jq .
```

```sql
-- Adapter run health
SELECT source, max(started_at) AS last_run, max(finished_at) AS last_finish,
       sum(rows) FILTER (WHERE started_at > now() - interval '7 days') AS rows_7d
FROM stacks.source_runs
GROUP BY source
ORDER BY last_run DESC;

-- Top of the pipeline with the factor breakdown
SELECT c.apn, c.score, c.status, p.units, p.neighborhood,
       c.score_factors -> 'distress' ->> 'detail' AS distress_detail
FROM stacks.candidates c
JOIN stacks.parcels p USING (apn)
WHERE c.status NOT IN ('dismissed','graduated')
ORDER BY c.score DESC
LIMIT 25;

-- Signal coverage on one parcel
SELECT type, source, event_date
FROM stacks.signals
WHERE apn = '0000000'
ORDER BY event_date DESC;

-- Candidates that graduated, with their Registry deal
SELECT c.apn, c.assignee_email, d.name, d.status
FROM stacks.candidates c
JOIN registry.deals d ON d.id = c.deal_id
ORDER BY c.last_scored_at DESC;
```

## Accuracy caveats

Do not present any of the following to an investment committee without checking it by hand.

| Caveat | Why it matters |
|--------|----------------|
| **Owned-property APN links are not all exact matches.** The original `portfolio.property_parcels` links were all produced by geo-nearest matching. The corrected `stacks.portfolio_parcels` links carry a `match_method` of `sfpim_address`, `sfpim_point`, or `geo_fallback`. Anything not `sfpim_address` deserves a spot-check | A wrong APN attributes another building's violations to ours |
| **Geo attribution over-counts.** Before the parcel-level linker replaced radius matching, a single building was credited with tens of thousands of permits belonging to the whole block. Any number sourced from a radius match is inflated | Civic counts must come from the APN join, not proximity |
| **Condo, retired, and suffix APNs miss.** SF Planning enrichment does not resolve every parcel. Coverage is partial by design and a missing planning panel is not a bug | Absent zoning or hazard data means unknown, not clean |
| **Tax delinquency and notice of default are no-ops on the free path.** Those adapters register and do nothing | A parcel showing no tax distress may simply have never been checked, unless a paid pull covered it |
| **PropertyRadar coverage is a band, not the market.** Records were pulled by distress-score tier, not exhaustively | Absence of a PropertyRadar record is not evidence of a clean parcel |
| **Rent upside is measured only where a Rent Board building match exists.** Everything else falls back to an estimate from year built and last sale date | Treat estimated upside as a screen, not an underwriting input |
| **DistressScore is a vendor composite.** It is a floor on our factor, not an independent confirmation | Do not cite it as a second opinion on our own signal scoring |

## Related pages

- [Stacks](/docs/apps/stacks)
- [Registry](/docs/apps/registry)
- [Command](/docs/apps/command)
- [Data Ingestion](/docs/data-ingestion)
- [Property Onboarding](/docs/property-onboarding)
- [Architecture Overview](/docs/architecture)
