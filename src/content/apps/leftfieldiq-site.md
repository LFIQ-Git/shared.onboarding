# Marketing Site Guide

leftfieldiq.com is the public-facing product site for Left Field IQ. It is a single page describing the platform, how it works, security and data handling, and the founder.

## What It Does

The marketing site is Left Field IQ's storefront for investors, partners, and prospective customers. The home page (`app/page.tsx`) carries these sections:
- **Hero:** "Operating Intelligence for Real Estate Portfolios."
- **About Left Field IQ** and **What Left Field IQ is**
- **Core capabilities** and **Inside the platform**
- **Who it's for** and **How it works**
- **Security & data handling**
- **Founder**

**Primary features:**
- Single landing page
- Header **Login** button that links to BRICK Hub (`NEXT_PUBLIC_BRICK_LOGIN_URL`, `https://hub.lfiq.app/login` in `wrangler.jsonc`)
- Site-wide password gate in `middleware.ts` (`SITE_PASSWORD`), with a login screen at `/login`
- Launch handoff from LFI Home at `/api/gate/handoff`, verified with an HMAC token signed by `LFIQ_HANDOFF_SECRET`
- PWA manifest and service worker

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://leftfieldiq.com | Live | Cloudflare Worker `lfiq-website` |
| **Local Dev** | http://localhost:3000 | Via `npm run dev` (`next dev`) | Local machine |
| **Local Worker** | http://localhost:3001 | Via `npm run dev:vinext` | Local machine |

`wrangler.jsonc` attaches two custom domains to the Worker: `leftfieldiq.com` and `lfiq.app`. The site is `leftfieldiq.com`. `leftfieldiq.app` does not resolve; do not link to it.

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 15 | React 19, App Router, built for Workers with vinext |
| **Language** | TypeScript | Full type coverage |
| **Styling** | Plain CSS | `styles/globals.css` |
| **Content** | TSX | Copy lives in `app/page.tsx` |
| **Hosting** | Cloudflare Workers | `npm run deploy:cloudflare` |
| **Auth** | Shared site password | `middleware.ts` and `lib/gate.ts`. No user accounts |

## Local Development

### Start the Site

```bash
git clone https://github.com/LFIQ-Git/lfiq.website.git
cd lfiq.website
npm run dev
# Runs on http://localhost:3000
```

### File Structure

```
lfiq.website/
├── app/
│   ├── page.tsx              # The single landing page
│   ├── layout.tsx            # Global layout and metadata
│   ├── login/page.tsx        # Password gate login screen
│   ├── api/auth/             # Password login endpoint
│   ├── api/gate/             # Launch handoff from LFI Home
│   ├── manifest.ts           # PWA manifest
│   └── components/PwaRegister.tsx
├── lib/
│   ├── gate.ts               # Password gate cookie and hash
│   └── launch-token.ts       # Handoff token verification
├── middleware.ts             # Site-wide password gate
├── styles/globals.css
├── public/                   # PWA icons, robots.txt, sw.js
└── wrangler.jsonc            # Worker name, vars, custom domains
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_BRICK_LOGIN_URL` | No | Target of the header Login button. Set to `https://hub.lfiq.app/login` in `wrangler.jsonc` |
| `SITE_PASSWORD` | Yes | Site-wide access password. If unset, the gate fails closed |
| `LFIQ_HANDOFF_SECRET` | No | HMAC secret for launch handoff tokens from LFI Home. If unset, the handoff route fails closed |

The template is `.env.example`. In production, set secrets with `npx wrangler secret put <NAME> --name lfiq-website`.

## Key Pages

### Page 1: Home (/)

The single landing page. Every section listed under What It Does lives in `app/page.tsx`.

### Page 2: Login (/login)

The password gate screen. Visitors without the gate cookie are sent here by `middleware.ts`.

## Common Tasks

### Task 1: Update Page Copy

Edit the relevant section in `app/page.tsx`, then check it locally with `npm run dev`.

### Task 2: Update Metadata

Edit the `metadata` export in `app/layout.tsx`.

## Troubleshooting

### Issue 1: "Every page shows the login screen, and the password is refused"
**Symptom:** The gate never lets you through  
**Cause:** `SITE_PASSWORD` is unset on the Worker, so the gate fails closed  
**Fix:**
```bash
npx wrangler secret list --name lfiq-website
```

### Issue 2: "Cloudflare deploy fails"
**Symptom:** `npm run deploy:cloudflare` errors out  
**Cause:** Build error or missing dependency  
**Fix:**
```bash
# Test the Worker build locally
npm run build:vinext

# Dry-run the deploy
npm run dry-run:cloudflare

# Stream production logs
npx wrangler tail lfiq-website
```

## Content Guidelines

### Tone & Voice
- **Professional but approachable**: Not stuffy, not overly casual
- **Real estate operator voice**: Speak like investors, not marketers
- **No jargon**: Explain concepts clearly
- **Specific over vague, but only with a figure you can source**: never invent a count. If you do not have the number, cut the sentence

### Images
- **Team photos:** Professional headshots (500x500px minimum, JPEG or PNG)
- **Feature icons:** Consistent style, 200x200px minimum
- **Product screenshots:** Clean, recent (no outdated UI)
- **Brand colors:** Use LFIQ brand guidelines (if published)

### Links
- **Internal links:** Use relative paths (/about, /careers)
- **External links:** Use full URLs (https://example.com)
- **No dead links**: Verify all URLs are current

## SEO & Meta Tags

Metadata is set in `app/layout.tsx`:
- `<title>`: defaults to "Left Field IQ · LFI", with the template "%s · Left Field IQ · LFI"
- `description`, `openGraph` (title, description, url, site name) and `robots`
- `metadataBase` is `https://leftfieldiq.com`

## Related Documentation

- **Getting Started:** Setup, Logins, Install Tools
- [Cloudflare Deployment](/docs/cloudflare-deployment)
- **Next.js:** App Router, metadata, SEO
