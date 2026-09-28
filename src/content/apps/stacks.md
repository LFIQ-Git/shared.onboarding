# Stacks App Guide

Stacks is the SF sourcing pipeline. It combines PropertyRadar data, distress indicators, and dossier research to identify acquisition opportunities in San Francisco.

## What It Does

Stacks focuses on SF multifamily deal sourcing:
- **Property search:** Query PropertyRadar, filter by cap rate, distress score, ownership
- **Dossier:** Detailed property profile including comparables, rent trends, market context
- **Distress scoring:** Automatic flagging of distressed properties
- **Pipeline:** Properties move through sourcing → underwriting → offer → closed
- **Market maps:** Neighborhood-level analysis, rent trends, competitive landscape

**Primary features:**
- Property search with filters (APN, address, cap rate, distress score)
- Property dossier (comparables, rent trends, ownership history)
- Neighborhood analysis
- Distress scoring engine
- Deal timeline

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://stacks.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-stacks` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 16 | React 19, App Router, built for Workers with vinext |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Cloudflare Access | Clerk was removed 2026-09-15. The `stacks` grant in `items.auth_allowed_users` is checked on `/login` and in `requireOperator` |
| **Database** | Neon (stacks schema) | Parcels, signals, candidates, source runs. Keyed on APN |
| **Property Data** | PropertyRadar API | SF property records, distress indicators. Gated paid adapter, excluded from cron |
| **Maps** | Mapillary (optional) | Street-level imagery, via `MAPILLARY_TOKEN` |
| **Deployment** | Cloudflare Workers | Workers Builds on push to main |

## Local Development

### Start the App

```bash
git clone https://github.com/LFIQ-Git/brick.stacks.git
cd brick.stacks
npm run dev
# Runs on http://localhost:3000
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `true` in `.env.local` to skip the Access gate |
| `DATABASE_URL` | Yes | Neon connection (stacks schema) |
| `ITEMS_HUB_DATABASE_URL` | Prod | Neon connection for the `items.auth_allowed_users` allowlist |
| `PROPERTYRADAR_API_TOKEN` | No | PropertyRadar data access. The adapter no-ops unless `PROPERTYRADAR_PURCHASE=1` |
| `MAPILLARY_TOKEN` | No | Street imagery (optional) |
| `CRON_SECRET` | Prod | Authorizes the cron routes |

For local dev, `.dev.vars.example` lists the Worker variables. Production secrets are Worker secrets: `npx wrangler secret list --name brick-stacks` lists the names, `npx wrangler secret put <NAME> --name brick-stacks` sets one.

## Key Features

### Property Search

Search properties by:
- **Address or APN**: Direct lookup
- **Cap rate**: Filter by expected return (e.g., 5% - 7%)
- **Distress score**: Filter by probability of foreclosure (0-100)
- **Price range**: Purchase price or estimated value
- **Ownership type**: Individual, corporate, etc.
- **Neighborhoods**: Filter by SF district or ZIP code

### Distress Scoring

Properties are automatically scored (0-100) based on:
- **Late payments**: Mortgage delinquency indicators
- **Liens**: Tax liens, judgment liens, HOA liens
- **Price trends**: Recent sales compared to market baseline
- **Ownership duration**: Properties owned < 5 years at higher risk
- **Mortgage info**: LTV ratio, recent refinancing

Properties with score > 70 are flagged as "High Distress."

### Dossier

Each property has a detailed dossier including:
- **Comparables**: Similar properties (same ZIP, same unit count ±20%)
- **Rent trends**: Historical rent for this property and neighborhood
- **Market context**: Neighborhood median rent, vacancy, rent growth
- **Ownership history**: Recent transfers, previous owners
- **Financials**: Estimated NOI, cap rate, value
- **Zoning**: Land use, density restrictions, height limits
- **Photos**: Mapillary street-level imagery (if available)

## Key Flows

### Flow 1: Search Properties
1. User navigates to stacks.lfiq.app
2. User enters search criteria:
   - Cap rate: 5-7%
   - Distress score: > 70
   - Location: SF
3. Submit → Query the Neon stacks schema
4. Results displayed: address, estimated value, distress score, recent sales
5. User clicks property → view dossier

### Flow 2: View Property Dossier
1. User clicks property from search results
2. Dossier loads with:
   - Property details (address, APN, units, beds, year built)
   - Comparables table (price per unit, cap rate)
   - Rent trend chart (last 5 years)
   - Neighborhood stats (median rent, vacancy, growth)
   - Ownership history (transfers, liens)
3. User can:
   - Add note
   - Mark as tracked
   - Open in PropertyRadar
   - Open in Google Maps
   - Generate report

### Flow 3: Nightly Sourcing Jobs
`scheduled()` in `worker/index.ts` maps each cron schedule to a job (rent-board, ingest, owner-enrich and others). `CRON_DISPATCH_ENABLED` in `wrangler.toml` is the switch. PropertyRadar is a paid adapter and is not part of the nightly run.

## Database Schema

The `stacks` schema is keyed on APN. Core tables:

| Table | Purpose |
|-------|---------|
| **parcels** | The universe, seeded from the SF assessor roll (5+ units) |
| **signals** | Typed source events per APN (assessor, mortgage, tax delinquent, and others), payload in jsonb |
| **candidates** | Scored candidates. Analyst-owned fields survive rescoring |
| **source_runs** | Per-source cursor and row counts |
| **parcel_info** | SF planning and hazard data |
| **rent_board_unit / rent_board_block / rent_board_building** | SF Rent Board rent roll and loss-to-lease rollups |

## Troubleshooting

### Issue 1: "PropertyRadar quota exceeded"
**Symptom:** Search returns error "PropertyRadar API limit reached"  
**Cause:** Monthly API quota exhausted (PropertyRadar bills per API call)  
**Fix:**
```bash
# Check current quota usage
# Check usage in the PropertyRadar account billing page

# Upgrade plan or wait for reset (usually monthly)
# Contact PropertyRadar support if overages appear incorrect
```

### Issue 2: "Property dossier takes 30+ seconds to load"
**Symptom:** Clicking on a property shows loading spinner for a long time  
**Cause:** Neon query timeout or PropertyRadar API slow response  
**Fix:**
```bash
# Warm Neon connection
psql "$DATABASE_URL" -c "SELECT 1 FROM stacks.parcels LIMIT 1;"

# If issue persists, check browser network tab (DevTools > Network)
```

### Issue 3: "Distress score not calculating"
**Symptom:** New properties show "Score: N/A" instead of numeric value  
**Cause:** The PropertyRadar pull is gated on billing, so the underlying distress fields never arrived. PropertyRadar is deliberately excluded from the free adapter set and does not run on a cron  
**Fix:**
```bash
# Verify any PropertyRadar distress data arrived. It lands in signal payloads
psql "$DATABASE_URL" \
  -c "SELECT apn, type, source FROM stacks.signals WHERE payload ? 'distress_score' LIMIT 5;"

# If the source fields are null, check the PropertyRadar billing gate before
# looking at the scoring code. The score is a floor computed from PropertyRadar
# data, so no data means no score.
```

## Common Tasks

### Task 1: Top-Scored Open Candidates
```sql
SELECT apn, score, status, last_scored_at
FROM stacks.candidates
WHERE status = 'open'
ORDER BY score DESC
LIMIT 20;
```

### Task 2: Signals for One Parcel
```sql
SELECT type, source, event_date
FROM stacks.signals
WHERE apn = $1
ORDER BY event_date DESC;
```

## Related Documentation

- **Architecture:** PropertyRadar integration, distress scoring, dossier data
- **Getting Started:** Setup, Logins, Install Tools
- **Registry:** Opportunities from Stacks can be moved to Registry for deal tracking
- **Command:** Once sourced, properties can be added to Command for monitoring
