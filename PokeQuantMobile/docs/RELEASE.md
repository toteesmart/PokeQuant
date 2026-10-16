# Release, Privacy & Asset Tooling — detail reference

Read before release work, App Store submissions, or touching legal links.
Day-to-day dev never needs this file.

## Privacy & legal

- `PRIVACY_POLICY.md` at the repo root is the live privacy policy
  surfaced in the app and App Store.
- `src/constants/legal.ts` provides `PRIVACY_POLICY_URL` (GitHub-rendered
  `PRIVACY_POLICY.md`) and `TERMS_OF_USE_URL` (Apple standard EULA).
- `PricingPreview` and `SettingsScreen` link to both. Ensure the policy
  file is committed and pushed to `main` before App Store submission or
  the link will 404.
- Do not add analytics, advertising identifiers, or non-essential
  tracking. `revenueCat.ts` explicitly disables RevenueCat
  device-identifier collection.

## Asset & screenshot tools

- `tools/Make-AppIcon.ps1` — generates 1024x1024 App Store icons from
  `store-assets/logo.png` with transparent background flood-fill, outputs
  `icon-dark.png` and `icon-light.png` to `screenshots/`.
- `tools/Make-StoreScreenshots.ps1` — resizes raw iPhone screenshots
  into 6.5" (`1284x2778`, cover-fit) and 13" iPad (`2048x2732`,
  contain-fit) App Store screenshot sets.
- These are helper scripts for release assets; they are not part of the
  runtime build.
- The final `assets/icon.png` committed to the repo must be an **opaque
  24-bit RGB PNG with no alpha channel**. App Store Connect rejects
  icons with transparency. If `Make-AppIcon.ps1` still outputs RGBA,
  re-export it with an opaque background before committing.

## App Store release configuration (2026-09-10)

- **Release branch:** `react-native-v2`. `main` only needs to host
  `PRIVACY_POLICY.md` for the GitHub-rendered privacy URL. Do not
  force-merge or fast-forward `react-native-v2` into `main` because that
  would delete the unmaintained root PWA files, which the project rules
  say to keep.
- **Splash screen:** configured through the `expo-splash-screen` config
  plugin in `app.json` (`backgroundColor: #0e1117`,
  `image: ./assets/splash-icon.png`, `imageWidth: 200`). The legacy
  top-level `expo.splash` block is not valid in Expo SDK 57.
- **iOS privacy manifest:** `app.json` contains `ios.privacyManifests`
  with collected data types (Name, Email, User ID, Purchase History,
  Product Interaction, Other User Content) and required reason APIs
  (UserDefaults `CA92.1`, File Timestamp `C617.1`, Disk Space `E174.1`).
- **Dependencies:** `expo-dev-client` was moved to `devDependencies` and
  excluded from `expo-doctor` version checks via `expo.install.exclude`
  in `package.json`. `expo-splash-screen` was added at `57.0.5`.
- **Account deletion:** `SettingsScreen` → `inventoryStore.deleteAccount()`
  calls `deleteVendorAccount()` first, which posts to
  `worker_show_vendor.js` `POST /vendor/delete-account`. The worker
  deletes public show listings, team memberships, the vendor row, and the
  Supabase auth user via the Supabase Admin API. It requires
  `SUPABASE_SERVICE_ROLE_KEY` (and optionally `SUPABASE_ANON_KEY`) in the
  Cloudflare worker environment.
- **Build readiness:** `npx tsc --noEmit`, `npx jest`, and
  `npx expo-doctor` all pass. An EAS `production` iOS build succeeded
  from `react-native-v2`.
