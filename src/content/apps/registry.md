# Registry App Guide

Registry is the deal tracking and CRM system for LFIQ. It manages opportunities, activities, documents, and communications across the deal pipeline.

## What It Does

Registry provides a centralized hub for deal sourcing and tracking:
- **Deals:** Acquisition opportunities with property details, financial metrics, status
- **Opportunities:** Early-stage prospects, comp analysis, PropertyRadar integration
- **Activities:** Calls, emails, meetings, notes on each deal
- **Documents:** Offering memorandums, term sheets, financial models, due diligence
- **Contacts:** Brokers, owners, advisors, lenders
- **Pipeline:** Stages (sourcing, underwriting, closing, monitoring, off-market)

**Primary features:**
- Deal browser and search
- Opportunity creation from PropertyRadar
- Deal financials (acquisition price, cap rate, IRR)
- Email forwarding ingest (deal@in.lfiq.app)
- Activity log
- Document management

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://registry.lfiq.app | Live | Vercel |
| **Preview** | https://registry-branch.lfiq.app | Auto-deploy on PR | Vercel |
| **Local Dev** | http://localhost:3004 | Via `npm run dev` | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 15 | React 19, App Router |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Clerk | Shared fleet instance. See [Clerk Authentication](/docs/clerk-auth) |
| **Database** | Neon (registry schema) | Deals, opportunities, activities, contacts |
| **Email Ingest** | Cloudflare Worker + Neon | deal@in.lfiq.app forwarding |
| **Deployment** | Vercel | Auto-deploy on main |

## Local Development

### Start the App

```bash
cd /path/to/brick.apps/apps/registry
npm run dev
# Runs on http://localhost:3004
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key. `BRICK_CLERK_PUBLISHABLE_KEY` is the fallback name |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key. `BRICK_CLERK_SECRET_KEY` is the fallback name |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `true` in `.env.local` |
| `DATABASE_URL` | Yes | Neon connection, pooled (registry schema). Never use `DATABASE_URL_UNPOOLED` here |
| `DEAL_INGEST_SECRET` | Yes | Email forwarding validation |

Do not pass the Clerk keys as module-level options to `clerkMiddleware`. Clerk reads them from the environment, and passing them explicitly breaks in the Edge Runtime.

Pull from Vercel:
```bash
vercel env pull
```

## Database Schema

The `registry` schema contains four main tables:

| Table | Purpose | Example |
|-------|---------|---------|
| **deals** | Acquisition opportunities | Property address, purchase price, cap rate |
| **opportunities** | Early-stage prospects | PropertyRadar listing, property type, location |
| **activities** | Deal interactions | Call with broker, email received, meeting scheduled |
| **contacts** | People and organizations | Broker name, title, email, phone |
| **documents** | Attached files | Offering memo, term sheet, financial model |

## Key Flows

### Flow 1: Create a Deal from PropertyRadar
1. User navigates to registry.lfiq.app/opportunities
2. User searches PropertyRadar data (integrated via API)
3. User clicks "Create Deal" on a property
4. Form pre-populated: address, parcel number, zoning, recent sales
5. User adds: purchase price, financing, expected IRR
6. Submit → INSERT into registry.deals
7. Opportunity moves to "Underwriting" stage

### Flow 2: Ingest Email via deal@in.lfiq.app
1. User forwards deal email to deal@in.lfiq.app
2. Cloudflare Worker captures email (to, from, subject, body, attachments)
3. Worker validates X-Forwarding-Secret header
4. Worker POSTs email payload to Registry ingest endpoint
5. Registry extracts deal info (property address, contact name, etc.)
6. Optionally creates new opportunity or links to existing deal
7. Email content saved as activity note
8. Attachments extracted to deal documents folder

### Flow 3: Update Deal Activity
1. User navigates to `registry.lfiq.app/deals/{dealId}`
2. User clicks "Add Activity"
3. Form: activity type (call, email, meeting, note), summary, date
4. Submit → INSERT into registry.activities
5. Activity appears in timeline
6. If type is "email," can attach forwarded message

## Troubleshooting

### Issue 1: "Email forwarding not working"
**Symptom:** Emails sent to deal@in.lfiq.app don't appear in Registry  
**Cause:** Cloudflare Worker failed, forwarding secret not set, or Neon ingest endpoint down  
**Fix:**
```bash
# Check Cloudflare Worker logs
# Log in to Cloudflare Dashboard
# Workers > Logs > Filter for deal-ingest

# Verify the secret is set on the Vercel project
vercel env ls

# Test ingest endpoint
curl -X POST https://registry.lfiq.app/api/ingest/email \
  -H "X-Forwarding-Secret: $DEAL_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "deal@in.lfiq.app",
    "from": "test@example.com",
    "subject": "Test Deal",
    "body": "Test message"
  }'
```

### Issue 2: "Deal creation returns error"
**Symptom:** Clicking "Create Deal" shows an error message  
**Cause:** Neon connection issue, missing fields, or database constraint violation  
**Fix:**
```bash
# Check form validation
# Ensure required fields are filled: address, purchase price, expected return

# Check database connection
psql "$DATABASE_URL" -c "SELECT 1 FROM registry.deals LIMIT 1;"

# Verify user has write permission
# Contact ops if receiving 403
```

### Issue 3: "PropertyRadar data not available"
**Symptom:** Property search returns no results  
**Cause:** PropertyRadar API key expired, quota exceeded, or integration disabled  
**Fix:**
```bash
# PropertyRadar is a gated paid adapter owned by Stacks, not Registry.
# Check the key on the Stacks Vercel project, not here
vercel env ls

# Verify quota hasn't exceeded
# Log in to PropertyRadar dashboard at https://portal.propertyradar.com

# Check integration status
# Ensure NEXT_PUBLIC_PROPERTYRADAR_ENABLED=true
```

## Common Tasks

### Task 1: Query Deals by Status
```sql
SELECT id, property_address, status, created_at
FROM registry.deals
WHERE status IN ('sourcing', 'underwriting')
ORDER BY created_at DESC;
```

### Task 2: Get Deal Activity Timeline
```sql
SELECT created_at, activity_type, summary
FROM registry.activities
WHERE deal_id = $1
ORDER BY created_at DESC
LIMIT 20;
```

### Task 3: Find Contacts for a Deal
```sql
SELECT c.name, c.title, c.email, c.phone
FROM registry.contacts c
JOIN registry.deal_contacts dc ON dc.contact_id = c.id
WHERE dc.deal_id = $1;
```

## Related Documentation

- **Architecture:** System topology, email ingest pipeline
- **Getting Started:** Setup, Logins, Install Tools
- **Command:** Portfolio management (deals feed into portfolio monitoring)
- **Intel:** Market data and observations can inform deal sourcing
