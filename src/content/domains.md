# Domains

Every primary domain the company owns or controls. Subdomains are not listed here; each app's own page covers the host it runs on.

Nameservers and apex responses re-checked 2026-09-27 with `dig NS` and `curl`. Registrar and renewal columns were not re-verified in that pass. Anything not on this list is not ours, no matter how much it looks like it should be.

## Primary Domains

| Domain | Used for | Registrar | DNS | Renews |
|--------|----------|-----------|-----|--------|
| `lfiq.app` | The BRICK app fleet. Every internal app is a subdomain here | External | Cloudflare | None |
| `leftfieldiq.com` | Public marketing site and investor materials | Cloudflare | Cloudflare | None |
| `leftfieldinv.com` | Left Field Investments corporate email and identity | External | Cloudflare | None |
| `lfihub.com` | Reserved | Unverified | Not Cloudflare | Unverified |
| `lfigallery.com` | Reserved | Unverified | Cloudflare | Unverified |
| `lfi.app` | Reserved. Not currently pointed at us | External | Sedo parking | None |
| `mosser.app` | Mosser-facing tooling | External | Cloudflare | None |
| `back9trades.com` | Back9 Trades, canonical domain | Unverified | Cloudflare | Unverified |
| `backninetrades.com` | Back9 Trades, second spelling. Apex returns 404 today | Unverified | Not Cloudflare | Unverified |
| `singerscott.io` | Singer & Scott, prospect engagement. Apex returns 404 today | Unverified | Not Cloudflare | Unverified |
| `7base.io` | Reserved | Unverified | Cloudflare | Unverified |
| `fahq.app` | Reserved | Unverified | Cloudflare | Unverified |
| `leftfield.app` | Not ours today. The apex redirects to a domain-sale page | External | Domain-sale parking | None |
| `fridgeart.app` | Fridgeart. No nameservers resolve today | External | None resolving | None |
| `pushinp.app` | Reserved | External | Cloudflare | None |

"Unverified" in the registrar or renewal column means the earlier record came from a registrar that is no longer part of the stack and has not been re-confirmed. Confirm the registration before relying on those rows.

Five of these serve a live site today: `lfiq.app` (the app fleet, behind Cloudflare Access), `leftfieldiq.com` (marketing, HTTP 200), `leftfieldinv.com` (HTTP 200), `back9trades.com` (Back9 Trades, HTTP 200), and `mosser.app` (behind Cloudflare Access). The ones marked reserved return a 404 at the apex.

## Where They Live

- **Cloudflare DNS.** `lfiq.app`, `leftfieldiq.com`, `leftfieldinv.com`, `lfigallery.com`, `mosser.app`, `back9trades.com`, `7base.io`, `fahq.app`, and `pushinp.app` all answer with `arvind.ns.cloudflare.com` and `daniella.ns.cloudflare.com`.
- **Not on Cloudflare.** `lfihub.com`, `backninetrades.com`, and `singerscott.io` still delegate to non-Cloudflare nameservers and return 404 at the apex.
- **Elsewhere.** `lfi.app` sits on Sedo parking and `leftfield.app` on a domain-sale lander. `fridgeart.app` has no resolving nameservers. None of the three serves anything of ours.
- **Cloudflare Registrar.** Registrar for `leftfieldiq.com`.

## Known Issues

These are broken or ambiguous. They are documented rather than quietly omitted so nobody rediscovers them the hard way.

**`backninetrades.com`, `singerscott.io`, and `lfihub.com` are off Cloudflare and return 404.** Their DNS is still delegated outside the stack. `back9trades.com` on Cloudflare is the Back9 Trades site that answers.

**`lfi.app` resolves to Sedo parking.** The nameservers are a domain-sale parking service and the apex does not respond with our content. Confirm the registration is still live before treating it as an asset.

**`leftfield.app` redirects to a domain-sale page.** Confirm whether it is still registered to us before treating it as an asset.

## Rules

- Internal apps go on `<app>.lfiq.app`. Nothing else. Each internal hostname sits behind its own Cloudflare Access application in the `lfiq` Access team.
- Do not register a new domain for an internal tool. Add a subdomain to `lfiq.app`.
- Public and client-facing properties are the exception and keep their own domains, which is why `leftfieldiq.com`, `back9trades.com`, and `singerscott.io` exist.
