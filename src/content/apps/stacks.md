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
| **Production** | https://stacks.lfiq.app | Live | Vercel |
| **Preview** | https://stacks-branch.lfiq.app | Auto-deploy on PR | Vercel |
| **Local Dev** | http://localhost:3005 | Via `npm run dev` | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 15 | React 19, App Router |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Clerk | Shared fleet instance. Production must use a `pk_live_` key. See [Clerk Authentication](/docs/clerk-auth) |
| **Database** | Neon (stacks schema) | Properties, dossiers, market data. Keyed on APN |
| **Property Data** | PropertyRadar API | SF property records, distress indicators. Gated paid adapter, excluded from cron |
| **Maps** | Mapillary (optional) | Street-level imagery |
| **Deployment** | Vercel | Auto-deploy on main |

## Local Development

### Start the App

```bash
cd /path/to/brick.apps/apps/stacks
npm run dev
# Runs on http://localhost:3005
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `BRICK_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` also works |
| `BRICK_CLERK_SECRET_KEY` | Yes | Clerk secret key. `CLERK_SECRET_KEY` also works |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Stacks ships with the gate enabled, so local API routes 401 against production keys until you set this |
| `DATABASE_URL` | Yes | Neon connection (stacks schema) |
| `PROPERTYRADAR_API_KEY` | Yes | PropertyRadar data access. Billing-gated |
| `NEXT_PUBLIC_MAPILLARY_API_KEY` | No | Street imagery (optional) |

Stacks refuses to build for production unless the publishable key starts with `pk_live_`.

Pull from Vercel:
```bash
vercel env pull
```

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
3. Submit → Query PropertyRadar API + Neon stacks schema
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

### Flow 3: Create Sourcing Alert
1. User saves a search (e.g., "Cap rate 5-7%, SF, distress > 70")
2. Alert runs nightly, checks PropertyRadar for new matches
3. New properties meeting criteria are added to "Alerts" tab
4. User notified (optional: Slack, email)
5. User reviews and moves promising properties to "Tracked"

## Database Schema

The `stacks` schema contains:

| Table | Purpose |
|-------|---------|
| **properties** | SF properties synced from PropertyRadar |
| **dossiers** | Cached dossier data (comparables, rent trends, market stats) |
| **tracked_properties** | User-marked properties being tracked |
| **sourcing_alerts** | Saved searches and alert subscriptions |

## Troubleshooting

### Issue 1: "PropertyRadar quota exceeded"
**Symptom:** Search returns error "PropertyRadar API limit reached"  
**Cause:** Monthly API quota exhausted (PropertyRadar bills per API call)  
**Fix:**
```bash
# Check current quota usage
# Log in to PropertyRadar dashboard at https://portal.propertyradar.com
# View account > Billing > API Usage

# Upgrade plan or wait for reset (usually monthly)
# Contact PropertyRadar support if overages appear incorrect
```

### Issue 2: "Property dossier takes 30+ seconds to load"
**Symptom:** Clicking on a property shows loading spinner for a long time  
**Cause:** Neon query timeout or PropertyRadar API slow response  
**Fix:**
```bash
# Warm Neon connection
psql "$DATABASE_URL" -c "SELECT 1 FROM stacks.properties LIMIT 1;"

# Check if PropertyRadar API is down
# https://status.propertyradar.com

# If issue persists, check browser network tab (DevTools > Network)
```

### Issue 3: "Distress score not calculating"
**Symptom:** New properties show "Score: N/A" instead of numeric value  
**Cause:** The PropertyRadar pull is gated on billing, so the underlying distress fields never arrived. PropertyRadar is deliberately excluded from the free adapter set and does not run on a cron  
**Fix:**
```bash
# Verify the properties table actually has the source fields
psql "$DATABASE_URL" \
  -c "SELECT id, address, distress_score FROM stacks.properties LIMIT 5;"

# If the source fields are null, check the PropertyRadar billing gate before
# looking at the scoring code. The score is a floor computed from PropertyRadar
# data, so no data means no score.
```

## Common Tasks

### Task 1: Search for High-Distress Properties
```sql
SELECT 
  id, address, estimated_value, distress_score, 
  last_sale_price, last_sale_date
FROM stacks.properties
WHERE distress_score > 70
  AND estimated_value BETWEEN 5000000 AND 15000000
  AND neighborhood = 'SF'
ORDER BY distress_score DESC
LIMIT 20;
```

### Task 2: Get Comparables for a Property
```sql
SELECT 
  p.address, p.units, p.estimated_value,
  ROUND(p.estimated_value / p.units, 0) as price_per_unit
FROM stacks.properties p
JOIN stacks.dossiers d ON d.property_id = p.id
WHERE d.comparable_to_id = $1
ORDER BY p.estimated_value DESC
LIMIT 10;
```

### Task 3: Analyze Rent Trends
```sql
SELECT 
  rent_date, avg_rent, median_rent, 
  (AVG(avg_rent) OVER (ORDER BY rent_date ROWS BETWEEN 12 PRECEDING AND CURRENT ROW)) as rent_trend_12m
FROM stacks.rent_history
WHERE property_id = $1
ORDER BY rent_date DESC
LIMIT 60;
```

## Related Documentation

- **Architecture:** PropertyRadar integration, distress scoring, dossier data
- **Getting Started:** Setup, Logins, Install Tools
- **Registry:** Opportunities from Stacks can be moved to Registry for deal tracking
- **Command:** Once sourced, properties can be added to Command for monitoring
