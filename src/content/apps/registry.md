# Registry App Guide

Registry is the deal tracking and CRM system for LFIQ. It tracks one record per live deal, with its parties, events, documents and forwarded email.

## What It Does

Registry provides a centralized hub for deal sourcing and tracking:
- **Deals:** Acquisition opportunities with property details, financial metrics, status
- **Candidates:** Sourced deals graduated from Stacks (`registry.deal_candidates`)
- **Events and updates:** Open items, deadlines and updates per deal
- **Documents:** Offering memorandums, term sheets, financial models, due diligence
- **Parties:** Lender, counsel, counterparty and internal contacts per deal
- **Pipeline:** Statuses (pipeline, active, closing, closed, dead)

**Primary features:**
- Deal browser and search
- Deal financials (acquisition price, cap rate, IRR)
- Per-deal email forwarding ingest (`d-<token>@deals.lfiq.app`)
- Activity log
- Document management

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://registry.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-registry` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 16 | React 19, App Router, built for Workers with `@opennextjs/cloudflare` |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Cloudflare Access | Clerk was removed 2026-09-15. Authorization is the `registry` grant in `items.auth_allowed_users`, checked on `/login` |
| **Database** | Neon (registry schema) | Deals, parties, events, compliance events |
| **Email Ingest** | Resend inbound webhook + Neon | Per-deal addresses on `deals.lfiq.app`, posted to `/api/inbound/resend` |
| **Deployment** | Cloudflare Workers | Workers Builds on push to main |

## Local Development

### Start the App

```bash
git clone https://github.com/LFIQ-Git/brick.registry.git
cd brick.registry
npm run dev
# Runs on http://localhost:3000
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `true` in `.env.local` |
| `DATABASE_URL` | Yes | Neon connection, pooled (registry schema). Never use `DATABASE_URL_UNPOOLED` here |
| `ITEMS_HUB_DATABASE_URL` | Prod | Neon connection holding `items.auth_allowed_users`. Falls back to `DATABASE_URL` |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Yes, for email ingest | Verifies the Resend (Svix) signature on `/api/inbound/resend` |
| `INBOUND_EMAIL_DOMAIN` | No | Domain for per-deal addresses. Defaults to `deals.lfiq.app` |
| `RESEND_API_KEY` / `NOTIFICATIONS_FROM` | Prod | Outbound notification email |
| `CRON_SECRET` | Prod | Bearer token the Worker's `0 14 * * *` cron trigger sends to `/api/notifications/run` |

For local dev, `.dev.vars.example` lists the Worker variables. Production secrets are Worker secrets: `npx wrangler secret list --name brick-registry` lists the names, `npx wrangler secret put <NAME> --name brick-registry` sets one.

## Database Schema

The `registry` schema's core tables (from `drizzle/migrations/0001_registry_schema.sql`):

| Table | Purpose |
|---------|---------|
| **deals** | One row per deal: name, type, status, property codes, target close date |
| **deal_parties** | Parties per deal: lender, counsel, counterparty, internal |
| **deal_events** | Open items and deadlines per deal |
| **compliance_events** | Code violations with dollar exposure, not keyed to a deal |

Later migrations add, among others, `deal_emails` (forwarded email ingest), `section_subscriptions` and `notifications`.

## Key Flows

### Flow 1: Create a Deal
1. User navigates to `registry.lfiq.app/deals/new`
2. User fills in the new deal form
3. Submit → INSERT into registry.deals

### Flow 2: Ingest Email to a Deal
1. Each deal has its own forwarding address, `d-<token>@deals.lfiq.app`, built from `registry.deals.inbox_token`
2. User forwards the email to that address
3. Resend receives it and posts a signed webhook to `/api/inbound/resend`
4. The route verifies the signature with `RESEND_INBOUND_WEBHOOK_SECRET` and finds the deal from the token in To or Cc
5. The email is stored in `registry.deal_emails` and processed against the deal. An unknown token is acknowledged with 200 so tokens cannot be enumerated

### Flow 3: Review a Deal
1. User navigates to `registry.lfiq.app/deals/{dealId}`
2. The detail page shows the deal's parties, events and timeline

## Troubleshooting

### Issue 1: "Email forwarding not working"
**Symptom:** Emails forwarded to a deal address don't appear in Registry  
**Cause:** `RESEND_INBOUND_WEBHOOK_SECRET` is not set (the route rejects every webhook with 401), the signature fails, or the address token does not match a deal  
**Fix:**
```bash
# Verify the secret name is set on the Worker
npx wrangler secret list --name brick-registry

# Watch the route while a test email arrives
npx wrangler tail brick-registry
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
# Check the key on the Stacks Worker, not here
npx wrangler secret list --name brick-stacks
```

## Common Tasks

### Task 1: Query Deals by Status
```sql
SELECT id, name, type, status, created_at
FROM registry.deals
WHERE status IN ('pipeline', 'active')
ORDER BY created_at DESC;
```

### Task 2: Get Open Items for a Deal
```sql
SELECT title, due_date, notes
FROM registry.deal_events
WHERE deal_id = $1 AND completed_at IS NULL
ORDER BY due_date;
```

### Task 3: Find Parties for a Deal
```sql
SELECT name, role, contact
FROM registry.deal_parties
WHERE deal_id = $1;
```

## Related Documentation

- **Architecture:** System topology, email ingest pipeline
- **Getting Started:** Setup, Logins, Install Tools
- **Command:** Portfolio management (deals feed into portfolio monitoring)
- **Intel:** Market data and observations can inform deal sourcing
