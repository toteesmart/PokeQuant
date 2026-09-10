# Privacy Policy — Card Cache

**Effective date:** September 8, 2026
**Operated by:** Totees Mart ("we", "us")

Card Cache is an offline-first inventory and pricing tool for trading card vendors. This policy explains what data the app collects, where it is stored, and who it is shared with.

## 1. Data We Collect

### Account information
When you sign in, we collect your **email address**, a **user ID**, and a **username** (display name) through our authentication provider, Supabase. Session tokens are stored on your device only, in the iOS Keychain / Android Keystore via `expo-secure-store`.

### Inventory and vendor data (your content)
Card inventory records, sales history, vendor settings, buy tiers, and sticker rules are stored **locally on your device** in SQLite databases. When you use cloud sync, this data is transmitted over HTTPS to our backend (Cloudflare Workers + Turso) so it can be restored on other devices.

If you publish listings to a show catalog, your **vendor display name, table location, card names, prices, and quantities** are made visible to other attendees browsing that show's catalog.

### Purchase information
If you buy a subscription, the purchase is processed by **Apple** and managed by **RevenueCat**. RevenueCat receives your app user ID (your account ID) and subscription status. We do not see or store your payment card details. We do not collect advertising identifiers or device fingerprinting data for purchases.

### What we do NOT collect
- No analytics or usage tracking SDKs
- No advertising identifiers (IDFA) or ad networks
- No contacts, photos, location, or other device data
- No device identifiers linked to purchase tracking (RevenueCat device-ID collection is disabled)

## 2. Third-Party Services

| Service | Purpose | Data shared |
|---|---|---|
| Supabase | Authentication | Email, user ID |
| Turso | Cloud database | Inventory/vendor data you sync |
| Cloudflare | API edge workers | Auth token, request data |
| RevenueCat | Subscription management | App user ID, entitlement status |
| Apple App Store | Payment processing | Handled entirely by Apple |
| TCGPlayer CDN | Card images & price data | Image requests (your IP is visible to TCGPlayer, as with any web content) |
| Cloudflare R2 | Catalog file downloads | Download requests |

Each provider processes data under its own privacy policy.

## 3. Data Retention & Deletion

- Local data stays on your device until you delete the app or clear it.
- You can permanently delete your account and all cloud-stored data at any time from **Settings → Delete All Account Info**.
- To request deletion or ask questions, contact us at the address below.

## 4. Children's Privacy

Card Cache is not directed at children under 13 and we do not knowingly collect data from children.

## 5. Changes to This Policy

If we update this policy, the revised version will be posted at this URL with a new effective date.

## 6. Contact

**Totees Mart**
Email: toteesmart@gmail.com
