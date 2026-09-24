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
| **Production** | https://sticks.lfiq.app | Live, git-connected auto-deploy | Vercel |
| **Preview** | https://sticks-branch.lfiq.app | Auto-deploy on PR | Vercel |
| **Local Dev** | http://localhost:3006 | Via `npm run dev` | Local machine |

Note the one-letter trap: `sticks.lfiq.app` is Sticks, `stacks.lfiq.app` is Stacks. They are different apps. `jr.lfiq.app` is attached to the Vercel project but has no DNS record, so it is dead.

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Frontend** | Next.js 15 | React 19, chat UI, thread management |
| **Language** | TypeScript | Full type coverage |
| **Auth** | NextAuth v5, Google provider | Sticks is the exception to the fleet Clerk migration. It has its own NextAuth setup with an email allowlist |
| **Backend** | Next.js API routes | Prompt assembly and context retrieval run in-app |
| **AI Model** | Anthropic Claude | Model id is set in code, check the repo before quoting one |
| **Context** | Neon + Pinecone | Portfolio data, vector search for RAG |
| **Deployment** | Vercel | Push to main auto-deploys, no promote step |

## Local Development

### Start the App

```bash
cd /path/to/brick.apps/apps/sticks
npm run dev
# Runs on http://localhost:3006
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `AUTH_SECRET` | Yes | NextAuth session encryption |
| `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID. Trailing whitespace here produces a confusing `invalid_client` error from Google |
| `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
| `AUTH_ALLOWED_EMAILS` | Yes | Comma-separated allowlist. The sign-in callback rejects anything not on it |
| `ANTHROPIC_API_KEY` | Yes | Claude API key (server only) |
| `DATABASE_URL` | Yes | Neon connection for context retrieval |

Pull from Vercel:
```bash
vercel env pull
```

## How It Works

### Sticks Architecture

```
User Chat Input
  ↓
Vercel Frontend (sticks.lfiq.app)
  ↓
NextAuth middleware (session check; API routes 401, pages redirect to /login)
  ↓
Prompt Assembly:
  1. System prompt (tuned for LFIQ context)
  2. User question
  3. Context (property data, recent observations, market trends)
  4. Document snippets (RAG from Pinecone)
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
3. Middleware checks the NextAuth session; an expired session returns 401 rather than redirecting, so the login page never streams into the transcript
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
6. Sticks: (retrieves comps from Pinecone) "Here are 5 similar properties in the area with rent data..."

### Flow 3: RAG (Retrieval-Augmented Generation)
1. User: "What did we learn about the Sunset district?"
2. Frontend posts to a Sticks API route
3. The route queries Pinecone for embeddings related to "Sunset district"
4. Top 5 documents/observations retrieved
5. Claude reads context and synthesizes answer
6. Response includes sources: "Based on observations from [dates], here's what we learned..."

## Chat Context

Sticks can access the following data for context:

| Data Type | Source | Purpose |
|-----------|--------|---------|
| **Properties** | Neon portfolio schema | Address, units, occupancy, rent roll |
| **Rent trends** | Neon market schema | Historical and current rent data |
| **Observations** | Neon items schema | Intel observations (delinquency, lease expirations, alerts) |
| **Comparables** | PropertyRadar (via Stacks) | Market comps, cap rates, distress scores |
| **Documents** | Pinecone embeddings | Stored research, investment memos, market reports |
| **Portfolio metrics** | Neon portfolio schema | Revenue, expenses, NOI, occupancy trends |

## Troubleshooting

### Issue 1: "Chat shows 'Error' state"
**Symptom:** After typing a question, red error appears  
**Cause:** The session expired (the API route returns 401), or the Anthropic key is missing  
**Fix:**
```bash
# Check the app health endpoint, which is public
curl https://sticks.lfiq.app/api/health

# Check the deployment and function logs
vercel logs --follow

# Confirm the key name is set on the project
vercel env ls

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

# Check function logs for context retrieval errors
vercel logs --follow

# Verify Pinecone embeddings are populated
# Log in to Pinecone console: https://app.pinecone.io
# Check vector count in index
```

### Issue 3: "Claude reference data that's incorrect or outdated"
**Symptom:** "What's the rent at 123 Main?" → Returns data from 3 months ago  
**Cause:** Neon data is stale, embeddings not updated, or context window too small  
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

- **Architecture:** System topology, auth model, Pinecone RAG
- **Getting Started:** Setup, Logins, Install Tools
- **Hub:** Similar chat interface (Brick chat), but on Clerk and proxied to the Fly backend
- [Vercel Deployment](/docs/vercel-deployment)
- **Anthropic API:** Claude models, pricing, rate limits
