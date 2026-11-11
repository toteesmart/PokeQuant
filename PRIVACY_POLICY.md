# Privacy Policy — Card Cache

**Effective date:** November 11, 2026
**Operated by:** Totees Mart ("we", "us")

Card Cache is an offline-first inventory and pricing tool for trading card vendors. This policy explains what data the app collects, where it is stored, and who it is shared with.

## 1. Data We Collect

### Account information
When you sign in, we collect your **email address**, a **user ID**, and a **username** (display name) through our authentication provider, Supabase. Session tokens are stored on your device only, in the iOS Keychain / Android Keystore via `expo-secure-store`.

### Inventory and vendor data (your content)
Card inventory records, sales history, vendor settings, buy tiers, and sticker rules are stored **locally on your device** in SQLite databases. When you use cloud sync, this data is transmitted over HTTPS to our backend (Cloudflare Workers + Turso) so it can be restored on other devices.

If you publish listings to a show catalog, your **vendor display name, table location, card names, prices, and quantities** are made visible to other attendees browsing that show's catalog.

If you create a share link for a binder or your collection, the catalog cards in it (card names, sets, conditions, quantities and market values, plus what you paid only if you choose to include it) are visible to anyone who has the link, in the app or on our website, without signing in. Manually added cards and your own photos are never included, and neither are your email or account ID. You can revoke a link at any time in the app, and deleting your account deletes all of your share links.

### Profile and table photos
You can add a **profile photo** in Settings → Profile. It is shown to the organizers of shows where you request a table, and next to your vendor name to everyone who downloads the catalog of a show you list in. Show organizers can also upload a **vendor photo** for a table (seen by that organizer) and a **floor plan** of the show (seen by the organizer and, if the organizer publishes it, by everyone who downloads that show). Photos are stored on Cloudflare R2. A photo is deleted when you replace or remove it, and deleting your account deletes your profile photo.

### Automated checking of what you publish
Photos and the text other people can see (your display name, show names and details, vendor names on listings, share link titles) are checked before they are published by an automated service, **OpenAI's moderation API**, which does not keep them or use them for training. Content that is clearly against our Community rules is refused and never stored. Borderline content is held privately until we review it, and is not shown to anyone else in the meantime.

For each check we keep a **moderation log** entry: your user ID, which part of the app it came from, a one-way fingerprint (SHA-256 hash) of the content (not the content itself), the result and its scores, and the time. Log entries are deleted after **90 days**.

### Reports and blocks
When you **report** content, we store your user ID, what you reported, the reason and any note you add. Reports from our website are not linked to an account: we store a one-way hash of the sender's IP address to limit abuse, never the IP address itself. Each report and each held item sends us an email notice with the kind of content, the reason and a short text excerpt (never the image). If we remove content for breaking the rules, we note it on the poster's account.

When you **block** someone, we store who you blocked so the app can hide their listings and shows on your devices. They are not told. You can unblock them in Settings. Deleting your account deletes the reports you filed and every block you made or received.

### Purchase information
If you buy a subscription, the purchase is processed by **Apple** and managed by **RevenueCat**. RevenueCat receives your app user ID (your account ID) and subscription status. We do not see or store your payment card details. We do not collect advertising identifiers or device fingerprinting data for purchases.

### What we do NOT collect
- No analytics or usage tracking SDKs
- No advertising identifiers (IDFA) or ad networks
- No contacts, location, or other device data. The only photos we receive are the ones you choose to upload (see "Profile and table photos")
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
| Cloudflare R2 | Catalog file downloads; storing uploaded photos | Download requests; the photos you or a show organizer upload |
| OpenAI (moderation API) | Automated check of photos and public text before they are published | The photo or text being checked. OpenAI does not keep it or use it for training |
| Cloudflare Email Routing | Delivers mail sent to our @cardcache.co addresses, and our moderation notices, to our support inbox (Gmail) | Your email and message; for notices, the kind of content, the reason and a short text excerpt, never an image |
| Cloudflare Pages | Website that shows share links | Page requests from people who open a link |
| Apple Maps | Store search when you type a Shop name (iOS) | The text you type in that field, sent as you type. The app does not share your device location |

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
Email: support@cardcache.co
To report content: use **Report** in the app, or email reports@cardcache.co
