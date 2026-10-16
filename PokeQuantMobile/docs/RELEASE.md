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
- **Crash reporting (plumbed, not yet activated):**
  `src/services/errorReporting.ts` routes `@sentry/react-native` through
  `utils/log`'s `setErrorSink` (fatal-JS capture comes from the SDK's own
  `ReactNativeErrorHandlers` integration — do not re-wrap `ErrorUtils`),
  gated on `!__DEV__` plus a DSN (`EXPO_PUBLIC_SENTRY_DSN` env or
  `extra.sentry.dsn` in `app.json`), so it is a no-op until configured.
  To activate: create the Sentry project, set the DSN, configure
  org/project for the `@sentry/react-native` app.json plugin (sourcemap
  upload), and rebuild. Before it ships to users, `PRIVACY_POLICY.md` on
  `main` must disclose crash-diagnostics collection and
  `ios.privacyManifests` needs a `CrashData`/Diagnostics collected-data
  entry.

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

## Versioning

- `eas.json` sets `cli.appVersionSource: "local"` — nothing
  auto-increments. `expo.version` (currently `1.0.2`) and
  `expo.ios.buildNumber` (currently `"23"`) are hand-edited in
  `app.json`.
- Bump `version` once per user-facing release. Bump `ios.buildNumber`
  on every iOS submission — App Store Connect rejects an upload whose
  buildNumber was already used for that version, so the value must
  increase monotonically and never repeat.
- **OTA coupling:** `runtimeVersion.policy: "appVersion"` pins the
  runtime version to `expo.version`, and `updates.url` routes
  `eas update` bundles (production builds bind the `production`
  channel). An OTA only reaches devices whose installed native build
  has the same `version` — bumping `version` redirects future OTAs to
  the new runtime and cuts older installs off. Publish any OTA meant
  for the current store build before bumping `version`; a native-code
  change still needs a new build and version bump, an OTA alone will
  not ship it.
- **Pre-Android-release tasks:** `extra.revenuecat.androidApiKey` is
  still the `goog_<YOUR_ANDROID_PUBLIC_API_KEY>` placeholder — replace
  it with the real Google Play public API key or purchases will not
  work (the app builds fine without it). `expo.android.versionCode` is
  also unset today and needs the same per-submission bump discipline as
  `ios.buildNumber` once Android ships.

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
