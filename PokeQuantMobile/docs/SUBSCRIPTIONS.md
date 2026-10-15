# RevenueCat / Subscriptions — detail reference

Read this before touching entitlements, products, paywall, or team seats.
The always-on rules in `AGENTS.md` carry the invariants (gating semantics,
worker product hygiene); this file holds the SKU/route detail. Pricing
strategy and launch sequencing: `.devin/pricing-plan.md`.

## RevenueCat configuration

- **Public API keys** live in `app.json` `extra.revenuecat.iosApiKey` /
  `androidApiKey` and are read at runtime via
  `src/constants/revenuecat.ts`. `getRevenueCatApiKey()` prefers
  `process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` /
  `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, then falls back to
  `Constants.expoConfig.extra.revenuecat`. Do not commit real keys to the
  repo; set them in the EAS build environment before a native build.
- **Native builds required.** RevenueCat (`react-native-purchases`) and
  the `react-native-zip-archive` native dependency do not work in Expo
  Go. Use `npx expo run:ios --device` / `npx expo run:android` or an EAS
  development build.
- `src/services/revenueCat.ts` configures `Purchases` once per install,
  with `automaticDeviceIdentifierCollectionEnabled: false`.

## Entitlements, offerings, products

- **Entitlements:** `Cardcache_pro` (all vendor features + unlimited
  scans) and `Cardcache_scan` (unlimited scans only — never unlocks
  vendor features). `hasActiveEntitlement(info, id)` in
  `src/services/revenueCat.ts` is parameterized; `subscriptionStore`
  exposes `hasVendorEntitlement()` and `hasScanEntitlement()`.
- **Offerings:** `collector`, `founders`, `pro`, `teams_extra_seat`.
- **Products:** `cc_founder_individual_monthly`,
  `cc_founder_team3_monthly`, `cc_pro_individual_monthly`,
  `cc_pro_team_base_monthly`, `cc_pro_team_extra_seat_monthly`,
  `cc_pro_individual_yearly` ($119.99), `cc_scan_unlimited_monthly`
  ($4.99), `cc_scan_unlimited_yearly` ($29.99). IDs live in
  `src/constants/revenuecat.ts`. Pro Individual has a yearly SKU; teams
  stay monthly-only.
- **Turso gating:** edge workers use `app_config.payments_live` (default
  `0`) and `vendor_subscriptions` to enforce paid-vendor status
  server-side. Founder status is not a free pass; it requires an active
  `vendor_subscriptions` row or active team membership. Do not flip
  `payments_live` to `1` until App Store products and the RevenueCat
  webhook are verified end-to-end.
- **Paywall:** `PricingPreview` supports fallback pricing when App Store
  products are not yet linked, and surfaces legal links (Privacy Policy,
  EULA/Terms of Use) plus a Restore Purchases button required by App
  Store review. `SubscriptionGate` renders it as an overlay and uses a
  local session flag to prevent the persisted `hasSeenPricingPreview`
  from re-appearing immediately after skip.
- **Worker secrets:** `worker_show_vendor.js` needs
  `REVENUECAT_SECRET_API_KEY`; the `/revenuecat-webhook` route also needs
  `REVENUECAT_WEBHOOK_SECRET`.

## Team subscriptions

Multi-seat team plans live alongside individual plans and are enforced
server-side in `worker_show_vendor.js`.

- **Team products:** `cc_founder_team3_monthly` and
  `cc_pro_team_base_monthly` grant a base of 3 seats;
  `cc_pro_team_extra_seat_monthly` adds 1 seat and is only purchasable
  when the user already owns an active team base. App Store subscription
  groups are `CardCache Pro Individual`, `CardCache Pro Team`, and
  `CardCache Pro Team Extra` — one active product per group.
- **Worker routes:**
  - `GET /vendor/team`
  - `POST /vendor/team/regenerate-code`
  - `POST /vendor/team/rename` — owner sets `teams.name`.
  - `POST /vendor/team/redeem`
  - `POST /vendor/team/remove`
  - `POST /vendor/team/leave`
- **Team enforcement:** `assertIsPaidVendor` grants access when the user
  has a direct active subscription or is an active member of a
  non-expired team. Founder status (`vendors.is_founder`) is a
  seat/discount label and does not bypass the active-membership
  requirement.
- **Mobile UI:** `PricingPreview` filters selectable plans by active
  product, founder eligibility (`isFounder`, `founderSeatNumber`, or
  `founderSeatsRemaining > 0`), and active team ownership for extra
  seats. `SettingsScreen` shows the Team card regardless of
  `paymentsLive`; owners see the team name input, invite code, seat
  usage, regenerate, and member list; members see the team name, owner,
  roster, and a Leave button; non-vendors see the redeem input.
  `Settings` and `PricingPreview` refresh `customerInfo` and the worker
  profile on mount to avoid stale state.
- **Member display:** `getTeamMembers` joins `vendors` to return
  `member_name`; `formatTeam` also returns `owner_name` and a `members`
  roster for both owners and teammates. `SettingsScreen` renders
  `Owner: <name>` and `Team member N: <name>`.
- **Founder seats:** `founder_counter` tracks the first 50 `vendors`
  rows. Existing vendors are grandfathered by `created_at` once during
  schema creation; new vendors claim the next open seat atomically. Churn
  does not refill seats; a churned founder retains `founder_seat_number`
  and `is_founder` is restored when any paid subscription becomes active
  again. `is_founder` is a seat/discount label; it does not grant
  vendor-feature access without an active subscription or active team
  membership.
