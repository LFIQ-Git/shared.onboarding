# Sticks App Guide

Sticks is a personal AI assistant powered by Claude. It provides real-time insights on LFIQ properties, market data, and internal knowledge, accessible via chat.

## What It Does

Sticks is an AI assistant tailored to LFIQ knowledge:
- **Property queries:** "What's the occupancy at 123 Main?" → Returns current property data
- **Market analysis:** "What are rents in the Mission?" → Analyzes market trends
- **Deal analysis:** "Should we bid on this property?" → Claude analyzes comps, cap rate, market risk
- **Knowledge retrieval:** "What did we learn about XYZ?" → Searches internal documents, observations, research
- **Recommendations:** Claude suggests actions based on portfolio data and market conditions

**Primary features:**
- Chat interface (web and iMessage)
- Context-aware responses (access to portfolio data, market data, history)
- Document search (Box, SharePoint, internal documents)
- Property briefing (current metrics, leases, rent trends)
- Multi-turn conversations (thread memory across sessions)

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://sticks.lfiq.app | Live, Workers Builds deploys on push to main | Cloudflare Worker `brick-sticks` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |

Note the one-letter trap: `sticks.lfiq.app` is Sticks, `stacks.lfiq.app` is Stacks. They are different apps. `jr.lfiq.app` has no DNS record, so it is dead.

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Frontend** | Next.js 16 | React 19, chat UI, thread management, built for Workers with `@opennextjs/cloudflare` |
| **Language** | TypeScript | Full type coverage |
| **Auth** | Cloudflare Access | NextAuth is gone. Middleware verifies the Access JWT; authorization is the `items.auth_allowed_users` row. Cron and webhook routes under `/api/sticks/*` authenticate themselves |
| **Backend** | Next.js API routes | Prompt assembly and context retrieval run in-app |
| **AI Model** | Anthropic Claude | Model id is set in code, check the repo before quoting one |
| **Context** | Neon | Portfolio data |
| **Deployment** | Cloudflare Workers | Workers Builds on push to main. Cron triggers in `wrangler.jsonc` are dispatched by `scheduled()` in `worker.ts` |

## Local Development

### Start the App

```bash
git clone https://github.com/LFIQ-Git/brick.sticks.git
cd brick.sticks
npm run dev
# Runs on http://localhost:3000
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key (server only) |
| `DATABASE_URL` | Yes | Neon connection for context retrieval |
| `ITEMS_HUB_DATABASE_URL` | Prod | Neon connection for the `items.auth_allowed_users` allowlist. Falls back to `DATABASE_URL` |
| `BRICK_AUTH_DISABLED` | No | Local dev only. Bypasses the Access gate |
| `CRON_SECRET` | Prod | Authorizes the cron routes |

Production secrets are Worker secrets: `npx wrangler secret list --name brick-sticks` lists the names, `npx wrangler secret put <NAME> --name brick-sticks` sets one.

## How It Works

### Sticks Architecture

```
User Chat Input
  ↓
Cloudflare Worker (sticks.lfiq.app), behind Cloudflare Access
  ↓
Access middleware (JWT check; API routes 401, pages redirect to /login)
  ↓
Prompt Assembly:
  1. System prompt (tuned for LFIQ context)
  2. User question
  3. Context (property data, recent observations, market trends)
  ↓
Anthropic API (Claude Opus or Sonnet)
  ↓
Response streamed back to frontend
  ↓
User sees answer in chat
```

### System Prompt Design

Sticks' system prompt tells Claude:
- You are Sticks, an AI assistant for LFIQ
- You have access to portfolio data (properties, rents, leases)
- You have access to market data (trends, comps, rent history)
- You have access to internal observations and knowledge
- Answer in plain operator voice
- Provide reasoning, not just answers

Example system prompt:
```
You are Sticks, an AI assistant for LFIQ. Your job is to help the investment team 
understand their portfolio and make better decisions.

You have access to:
- Portfolio data: properties, units, rents, leases, valuations
- Market data: rent trends, competitor activity, comps, distress indicators
- Internal knowledge: observations from the Intel source registry, prior analysis

When asked a question, use this data to answer. Show your reasoning. If data is missing, say so.
Speak like a real estate operator. No jargon. No unnecessary caveats.
```

## Key Flows

### Flow 1: Answer Property Question
1. User types: "What's the occupancy at 123 Main?"
2. Frontend posts to a Sticks API route
3. Middleware checks the Access identity; a failed check on an API route returns 401 rather than redirecting, so the login page never streams into the transcript
4. The route retrieves from Neon:
   - Property record (address, units, units occupied)
   - Lease status (upcoming expirations)
   - Rent data (current market, achieved rents)
5. Context assembled: "Property 123 Main has X units, Y occupied (Z%), market rent is $M"
6. Claude responds: "Occupancy is Z%. Current market rent is $M, you're getting $M+. Lease expirations: [list]"
7. Response streamed to user

### Flow 2: Multi-turn Conversation
1. User: "Should we increase rent at 123 Main?"
2. Sticks: "You're currently at $2,000. Market is $2,200. Risk is tenant turnover."
3. User: "What's tenant turnover rate in the neighborhood?"
4. Sticks: (retrieves historical turnover data) "Turnover in neighborhood is 15% annually. Your property is 10%. Strong performance."
5. User: "Show me comparables"
6. Sticks: "Here are 5 similar properties in the area with rent data..."

## Chat Context

Sticks can access the following data for context:

| Data Type | Source | Purpose |
|-----------|--------|---------|
| **Properties** | Neon portfolio schema | Address, units, occupancy, rent roll |
| **Rent trends** | Neon market schema | Historical and current rent data |
| **Observations** | Neon items schema | Intel observations (delinquency, lease expirations, alerts) |
| **Comparables** | PropertyRadar (via Stacks) | Market comps, cap rates, distress scores |
| **Portfolio metrics** | Neon portfolio schema | Revenue, expenses, NOI, occupancy trends |

## Troubleshooting

### Issue 1: "Chat shows 'Error' state"
**Symptom:** After typing a question, red error appears  
**Cause:** The Access session expired (the API route returns 401), or the Anthropic key is missing  
**Fix:**
```bash
# Stream the Worker logs
npx wrangler tail brick-sticks

# Confirm the key name is set on the Worker
npx wrangler secret list --name brick-sticks

# Sign out and back in, then clear site data
# DevTools > Application > Clear Site Data
```

### Issue 2: "Claude gives generic answer without property data"
**Symptom:** "What's occupancy?" → "I don't have access to that data"  
**Cause:** Context retrieval failed, property not found, or prompt issue  
**Fix:**
```bash
# Verify property exists in Neon
psql "$DATABASE_URL" \
  -c "SELECT address FROM portfolio.properties WHERE address ILIKE '%<street>%';"

# Check Worker logs for context retrieval errors
npx wrangler tail brick-sticks
```

### Issue 3: "Claude reference data that's incorrect or outdated"
**Symptom:** "What's the rent at 123 Main?" → Returns data from 3 months ago  
**Cause:** Neon data is stale, or context window too small  
**Fix:**
```bash
# Verify Neon has latest data
psql "$DATABASE_URL" \
  -c "SELECT created_at, monthly_rent FROM portfolio.units WHERE property_id = $1 ORDER BY created_at DESC LIMIT 1;"

# If the underlying data is stale, the problem is upstream in ingest, not in Sticks.
# Check the Intel source health page and the batch jobs on Fly
open https://intel.lfiq.app/sources
flyctl logs -a brick-cron
```

## Common Tasks

### Task 1: Ask Sticks a Property Question
Open https://sticks.lfiq.app and ask:
- "What's occupancy at [property name]?"
- "What rents are we getting at [property]?"
- "Should we bid on [address]? Compare to comps."
- "What are lease expirations at [property] in the next 90 days?"

### Task 2: Search Knowledge Base
Ask Sticks:
- "What did we learn about [neighborhood]?"
- "Show me recent investment memos on [topic]"
- "What's our analysis on [property type]?"

### Task 3: Analyze Market Trends
Ask Sticks:
- "What are rent trends in [neighborhood]?"
- "How is the market in [district] compared to [other district]?"
- "What neighborhoods have highest rent growth?"

## Related Documentation

- **Architecture:** System topology, auth model
- **Getting Started:** Setup, Logins, Install Tools
- **Hub:** Similar chat interface (Brick chat), proxied to the Fly backend
- [Cloudflare Deployment](/docs/cloudflare-deployment)
- **Anthropic API:** Claude models, pricing, rate limits
