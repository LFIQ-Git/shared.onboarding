# Cloudflare Workers deployment

This repository keeps the existing Next.js and Vercel path intact. Cloudflare
uses the separate vinext scripts and configuration.

## Compatibility

- Adapter: vinext `1.0.0-beta.9`, Cloudflare's recommended Next.js path as of
  September 8, 2026. Vinext is still beta.
- Compatibility check: 85%. All imports and libraries are supported.
- Partial support: image optimization and App Router strict-mode wrapping.
  Images remain unoptimized, matching `next.config.ts`.
- Runtime content: vinext uses build-time raw imports for Markdown. The original
  Next.js build continues to use filesystem reads.
- PDF generation: jsPDF remains in-process and uses the request origin. No
  Chromium or Browser Rendering binding is required.
- No database, Clerk middleware, scheduled routes, or runtime secrets were
  found in this application.

## Commands

```bash
npm run dev                 # Existing Next.js development server
npm run build               # Existing Next.js production build
npm run dev:vinext          # Vinext development server on port 3001
npm run build:vinext        # Build the Worker output
npm run preview:cloudflare  # Build and preview with workerd
npm run dry-run:cloudflare  # Build and run Wrangler's deployment dry-run
npm run cf-typegen          # Regenerate Cloudflare binding types
```

## Production safety

The configured Worker is `shared-onboarding`, and the intended custom domain is
`onboarding.lfiq.app`. Before running `npm run deploy:cloudflare`:

1. Confirm the Cloudflare account and identify any Worker already using that
   name.
2. Confirm what currently serves `onboarding.lfiq.app`; do not replace an
   existing custom-domain route unintentionally.
3. Inventory the active Worker's binding names and types. This app currently
   requires no secret bindings.
4. Deploy, then verify `/`, `/docs`, `/search-index.json`, and `/api/pdf`.
5. Keep the Vercel deployment active until the custom domain and all assets pass.

The prior report records the Vercel fallback at
`https://02-onboarding-manual.vercel.app`; the custom domain previously failed
certificate setup and must be revalidated before cutover.
