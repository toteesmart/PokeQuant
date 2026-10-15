# Card Cache Pricing Plan

## Overview

Effective: 2026-09-08

Card Cache is the shipping name for PokeQuantMobile on Apple TestFlight.

## Plans

| Plan | Price | Details |
|------|-------|---------|
| Free | $0 | 7-day unlimited scan trial from first Scan tab visit, then 15 scans/day. Show browsing, catalog search, prices, organizer tools stay free forever. |
| Collector | $4.99/mo or $29.99/yr | Unlimited scans only (`Cardcache_scan` entitlement). Never unlocks vendor features. |
| Founder Individual | $7.99/mo | First 50 seats only. 1 seat max per account. Forever grandfathered. |
| Founder Team 3 | $14.99/mo | First 50 teams only. 3 seats max per team. Forever grandfathered. |
| Pro Individual | $14.99/mo or $119.99/yr | Standard single-user plan (`Cardcache_pro`, includes unlimited scans). |
| Pro Team | $34.99/mo for first 3 seats | 3 seats included. +$9.99 per additional seat. |

### Why these prices?

App Store Connect only supports fixed price tiers, not arbitrary amounts. The closest tiers to the original targets were selected:
- Collector: $4.99 matches Ludex's single-category tier; $29.99/yr undercuts Ludex's $44.99/yr (~50% off vs monthly — aggressive to drive cash upfront and low churn at launch)
- Pro Individual: $14.99 (closest to $15.99; lower tier chosen to keep entry price friendly); $119.99/yr is ~33% off
- Founder Team 3: $14.99 (chosen for the first 50 teams; strong per-seat value vs Pro Individual)
- Pro Team: $34.99 (closest to $35)
- Pro Team Extra Seat: $9.99
- Team products stay monthly-only — seat churn makes annual awkward.

## Scan meter spec

- `FREE_DAILY_SCAN_LIMIT = 15`, `SCAN_TRIAL_DAYS = 7` in `src/scanner/store/scanMeterStore.ts` (Zustand + AsyncStorage, device-local; reinstall resets).
- Trial stamps `installedAt` on first Scan tab visit; count increments on every successful `processPhoto` (failed captures are free).
- At the limit: hard block — the shutter opens `ScanLimitSheet` instead of taking a photo; dismissing keeps the shutter gated until local midnight or an entitlement.
- Unlimited = `Cardcache_scan` OR `Cardcache_pro` OR `profile.isVendor`/`isTeamMember`.
- Meter is independent of `payments_live` — always on.

## Gating matrix

- **Free forever:** show list + event-catalog download/browse (no auth), organizer tools (`is_organizer` only), catalog search + prices, manual inventory.
- **Collector (`Cardcache_scan`):** unlimited scans — nothing else.
- **Pro (`Cardcache_pro`):** everything in Collector + buy tiers/sticker rules/offers, show upload + publish, team seats.
- Vendor feature gate stays `canUseVendorFeatures()` (free for all while `payments_live = 0`); launch banner on vendor screens warns that Pro is required after launch.
- Deferred (post-show): inventory cap ~250, analytics/velocity paid-only, scanner offer math vendor-only, CSV export gate.

## App Store Connect subscription groups

- **CardCache Pro Individual** (existing): `cc_pro_individual_monthly`, `cc_founder_individual_monthly`, plus new `cc_pro_individual_yearly`, `cc_scan_unlimited_monthly`, `cc_scan_unlimited_yearly`. One active sub per group means Pro and Collector can never double-bill — scan→Pro is an upgrade.
- **Level order (top→bottom):** pro yearly → pro monthly → founder monthly → scan yearly → scan monthly. Yearly above monthly so annual purchases take effect immediately; scan→pro upgrades are instant; pro→scan is a downgrade at next renewal.
- **CardCache Pro Team** (existing): `cc_pro_team_base_monthly`, `cc_founder_team3_monthly` — untouched.
- **CardCache Pro Team Extra** (existing): `cc_pro_team_extra_seat_monthly` — must stay in its own group so it can stack with a base plan.
- In-app: `PricingPreview` locks Collector packages for users with Pro-level access (`isVendor`/`isTeamMember`/`Cardcache_pro`) — prevents redundant crossgrades.

## Notes

- Founders plans are a launch incentive. Once 50 founder seats/teams are sold, the tier is closed.
- Founder pricing is intended to reward early adopters, not to be a permanent discount tier.
- Pro Team overage seats are billed at $9.99/mo, which is cheaper than the Pro Individual rate to encourage team growth.
- Team plan is a per-seat model with a 3-seat base bundle, not a flat “3-or-more” single subscription.

## Considerations / Open Questions

- Forever grandfathering can create long-term revenue drag. Consider capping founder plans to a fixed 12- or 24-month window if the plan is revisited.
- Founder Team 3 at $14.99/mo = $5.00/seat, which undercuts the Pro Individual $14.99/seat. Ensure the paywall clearly communicates the 3-seat max, founder-limited availability, and overage pricing for Pro Team to avoid confusion.
- Pro Individual and Founder Team 3 both price at $14.99 — this is an intentional, aggressive launch incentive but may look unusual side-by-side in the paywall. Consider framing it as “Founder Team: same price as Pro Individual, for 3 seats.”
