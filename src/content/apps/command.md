# Command App Guide

Command is the portfolio management system for LFIQ. It provides operators with property data, leasing workflows, maintenance tracking, collections management, and risk scoring.

## What It Does

Command is a comprehensive portfolio operating system:
- **Properties:** Unit count, occupancy, rent rolls, lease maturity
- **Leasing:** Tenant pipeline, move-outs, re-rent timeline, velocity
- **Maintenance:** Work orders, cost tracking, technician dispatch
- **Collections:** Delinquency cases, payment tracking, resident exclusions
- **Risk:** Property risk scores, market warnings, lease expiry alerts
- **Reporting:** Dashboards, metrics, historical trends

**Primary features:**
- Property browser (search, filter, bulk actions)
- Rent roll editor
- Lease expiry timeline
- Work order dispatch
- Collections dashboard
- Risk scoring engine

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://command.lfiq.app | Live | Vercel (frontend) + Fly.io (backend) |
| **Preview** | https://command-branch.lfiq.app | Auto-deploy on PR | Vercel |
| **Local Dev** | http://localhost:3002 | Via `npm run dev` | Local machine |

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Frontend** | Next.js 15 monorepo | React 19, 8 npm workspaces under `apps/`: web, collect, leasing, repair, documents, utilities, payables, civic |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Clerk | `createBrickClerkGate(appKey)` from `packages/brick-middleware`, one gate per sub-app |
| **Database** | Neon (portfolio, collect, repair schemas) | Direct + pooled connections |
| **Backend API** | Fly.io (brickston-backend) | FastAPI, Neon access, GraphQL |
| **GraphQL** | Fly.io | Schema defined in brickston-backend |
| **Jobs** | Fly `brick-cron` (supercronic) | Valuation, PBI sync, GDM extract, briefings, insight tagging |
| **Deployment** | Vercel + Fly.io | Vercel auto-deploys on main; Fly is a manual deploy |

## Local Development

### Start the App

```bash
cd /path/to/brick.apps/apps/command
npm run dev
# Runs on http://localhost:3002
```

**Note:** Command is an npm-workspaces monorepo. Run `npm ci` at the repo root, never inside a workspace. The root lockfile is authoritative and a stray per-app lockfile will break the Vercel build.

### Sub-apps

None of the workspaces pin a port. Each runs `next dev`, which takes 3000 and increments, so start only the one you are working on.

- **web**: Main portfolio management UI
- **leasing**: Leasing pipeline, vacancy
- **collect**: Collections, delinquency cases
- **repair**: Maintenance, work orders
- **utilities**: Utility tracking, bills
- **documents**: Document uploads, sharing
- **payables**: Accounts payable
- **civic**: SF civic data surfaces

Each workspace deploys to its own Vercel project with a distinct Root Directory, all from the one repo.

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `DATABASE_URL` | Yes | Neon connection (portfolio schema, command role) |
| `DATABASE_URL_UNPOOLED` | Yes | Neon direct, migration tooling only |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key. `BRICK_CLERK_PUBLISHABLE_KEY` is the fallback name |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key. `BRICK_CLERK_SECRET_KEY` is the fallback name |
| `BRICK_CLERK_ORGANIZATION_ID` | Yes | Clerk org whose role decides app access |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Set `1` or `true` to bypass the gate |
| `BRICKSTON_BACKEND_URL` | Yes | Backend API base (Fly.io) |
| `BRICKSTON_SCHEDULER_SECRET` | Yes | Shared secret for scheduler and report-import calls |
| `COMMAND_REFRESH_SECRET` | Yes | Guards `/api/refresh`, the cache-invalidation hook |

Pull from Vercel:
```bash
vercel env pull
```

## Backend: Fly.io brickston-backend

Command's backend is a Python FastAPI application running on Fly.io. It provides:
- GraphQL API (portfolio, properties, leases)
- Neon database proxy
- Rate limiting and caching
- Authentication validation

### Deploying Changes to Fly.io

Fly builds locally, so a Docker daemon has to be running first. Docker Desktop is not installed on the operator machine; the daemon is colima.

```bash
# After git push to main
git push origin main

# Bring the Docker daemon up
colima start

# Deploy from the backend directory, always from main
cd brick.command/backend
flyctl deploy --app brickston-backend --local-only
```

DNS warnings at the end of a deploy are local resolver noise. Check `flyctl status -a brickston-backend` for passing health checks instead.

### Viewing Fly.io Logs

```bash
flyctl logs --app=brickston-backend --follow

# Or check recent logs
flyctl logs --app=brickston-backend --limit=50
```

## Key Flows

### Flow 1: Property Overview
1. User navigates to command.lfiq.app/properties
2. Frontend queries Fly.io GraphQL endpoint for all properties
3. Results include: property ID, address, units, occupancy, net rent
4. User clicks property → detailed view with rent roll, leases, maintenance

### Flow 2: Create Work Order
1. User navigates to repair.lfiq.app
2. User clicks "New Work Order"
3. Form: select property, unit, issue type, urgency, assigned technician
4. Submit → INSERT into repair.wo_dispatch
5. Dispatch event recorded in repair.dispatch_events
6. Technician receives the assignment

### Flow 3: Delinquency Case Management
1. User navigates to collect.lfiq.app
2. Dashboard shows delinquency cases (overdue payments)
3. User clicks case → resident interaction history, payment agreements
4. Options: mark as paid, set payment plan, refer to attorney, resident exclusion
5. Case workflow: Open → Resolution (paid/default/legal)

## Database Schema

Command owns three schemas in the shared `neondb` database. Cross-schema joins are valid SQL, since it is one database.

**portfolio** (primary)
- properties, units, dim_* and fact_* tables, financials, materialized metric views

**collect** (collections management)
- ar_snapshot, collection_month, resident_workflow_state, resident_collection_exclusion

**repair** (maintenance)
- wo_dispatch, dispatch_events, wo_costs, wo_invoices, wo_photos, wo_surveys, technicians

Command also reads `gdm.*` (Power BI Golden Data Model) and `market.*` (leasing and competitor intel) on separate pools.

## Troubleshooting

### Issue 1: "Backend API timeout"
**Symptom:** Property list takes 30+ seconds to load  
**Cause:** Fly.io app sleeping, Neon connection timeout, or slow GraphQL query  
**Fix:**
```bash
# Wake up Fly.io app
curl https://brickston-backend.lfiq.app/health
# Should respond with 200 OK

# Check Fly.io status
flyctl status --app=brickston-backend

# Warm Neon connection
psql -h ep-tiny-lab-akrddwgy.us-west-2.neon.tech \
  -U command neondb -c "SELECT 1 FROM portfolio.properties LIMIT 1;"
```

### Issue 2: "Rent roll editor doesn't save changes"
**Symptom:** Clicking "Save" shows loading state but nothing persists  
**Cause:** GraphQL mutation failed, Neon RLS denied write, or session expired  
**Fix:**
```bash
# Check browser network tab (DevTools > Network)
# Look for failed GraphQL mutation request
# Verify response status and error message

# If 403 Forbidden: user doesn't have write permission
# Contact ops team to update user role

# If 500 Internal Server Error: check Fly.io logs
flyctl logs --app=brickston-backend
```

### Issue 3: "Work order not appearing after dispatch"
**Symptom:** Created a work order in repair.lfiq.app but it does not show as dispatched  
**Cause:** The dispatch write failed, or no technician was assigned  
**Fix:**
```bash
# Verify the dispatch row was created
psql "$DATABASE_URL" \
  -c "SELECT * FROM repair.wo_dispatch WHERE created_at > now() - interval '1 hour';"

# Check the event trail
psql "$DATABASE_URL" \
  -c "SELECT * FROM repair.dispatch_events ORDER BY created_at DESC LIMIT 20;"

# Check the backend for the failed write
flyctl logs --app brickston-backend
```

## Common Tasks

### Task 1: Query Properties
```sql
-- Get all properties with occupancy
SELECT 
  p.id, p.address, 
  COUNT(u.id) as unit_count,
  SUM(CASE WHEN u.occupied THEN 1 ELSE 0 END) as occupied_units,
  ROUND(100.0 * SUM(CASE WHEN u.occupied THEN 1 ELSE 0 END) / COUNT(u.id), 2) as occupancy_pct
FROM portfolio.properties p
LEFT JOIN portfolio.units u ON u.property_id = p.id
GROUP BY p.id, p.address
ORDER BY p.address;
```

### Task 2: Find Lease Expirations (Next 90 Days)
```sql
SELECT 
  p.address, u.unit_number,
  l.resident_name, l.move_out_date
FROM portfolio.properties p
JOIN portfolio.units u ON u.property_id = p.id
JOIN portfolio.leases l ON l.unit_id = u.id
WHERE l.move_out_date BETWEEN now() AND now() + interval '90 days'
ORDER BY l.move_out_date ASC;
```

### Task 3: Create a Delinquency Case
```sql
INSERT INTO collect.delinquency_cases (
  unit_id, resident_id, status, 
  amount_owed, days_past_due, 
  created_at
) VALUES (
  $1, $2, 'open',
  1500.00, 45,
  now()
);

-- Then notify collections team
-- (Usually done by trigger or application code)
```

## Sub-app Guides

Each sub-app within Command has specialized workflows:

| Sub-app | Purpose | Key Tables |
|---------|---------|-----------|
| **web** | Portfolio overview | portfolio.properties, portfolio.units |
| **leasing** | Vacancy pipeline | market.listings_current, market.mosser_vacant |
| **collect** | Collections | collect.ar_snapshot, collect.resident_workflow_state |
| **repair** | Work orders | repair.wo_dispatch, repair.wo_costs |
| **utilities** | Utility management | Not verified, confirm with Justin |
| **documents** | Document index | Not verified, confirm with Justin |
| **payables** | Accounts payable | Fed by the AP report import. Table names not verified |
| **civic** | SF civic data | market.sf_parcels, market.sf_addresses |

See each sub-app's own documentation for detailed workflows.

## Related Documentation

- **Architecture:** Fly.io backend, GraphQL API, database schema
- **Getting Started:** Setup, Logins, Install Tools
- **Intel:** Observations feed into Command inbox
- [Fly.io Backend](/docs/fly-io-backend)
- [Clerk Authentication](/docs/clerk-auth)
