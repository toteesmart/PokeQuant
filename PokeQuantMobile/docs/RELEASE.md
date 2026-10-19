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

## UI verification

Maestro flows in `maestro/flows/` are the on-device verification net —
they catch crashes and blank surfaces that jest + `lint:ui` cannot.

**Local runbook** (`tools\ui-screenshots.ps1`):

1. Install a dev-client build on the target: `npx expo run:android`
   (or install an EAS development build). Expo Go cannot run this app.
2. **Dev-client prerequisite:** the installed debug build launches into
   the expo-dev-client server picker, not the app — `launchApp` fails
   on it. Serve the bundle first: `npx expo start`, then
   `adb reverse tcp:8081 tcp:8081`, then connect the client once via
   `adb shell am start -a android.intent.action.VIEW -d
   "exp+pokequantmobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.
   Afterwards `launchApp` reloads the remembered URL straight into the
   app (session state like sign-in persists between runs).
3. Attach a device or let the script boot the `Pixel_10_Pro` AVD
   (override with `-AvdName`). The script waits for
   `sys.boot_completed` and dismisses the keyguard.
4. Run `powershell -ExecutionPolicy Bypass -File tools\ui-screenshots.ps1`.
   It runs `maestro test` over every flow and copies the PNGs into
   `artifacts\ui-screens\<flow>\` (gitignored). Maestro must be on PATH
   — on this machine it lives at `C:\maestro\maestro\bin\maestro.bat`.

Flow → surface coverage (verified live on `Pixel_10_Pro`, item 41):

| Flow | Reaches | Asserts |
| --- | --- | --- |
| `01-tabs-tour` | all four tabs | tab pill mounts each screen; testIDs `tab-{inventory,scan,search,shows}` |
| `02-search` | Search & Buy | search hint tap, results/empty state, image → `CardImageViewer`, close |
| `03-shows` | `EventListScreen` | "Upcoming Shows" header + list/empty/loading |
| `04-scan-tab` | Scan tab | any surface — download gate, camera permission, meter, preview |
| `05-inventory-radar` | Inventory | `SegmentedPills` Cards ↔ Resticker switch |
| `06-settings-gear` | `SettingsScreen` | gear contentDescription tap, sections render, system back |

**Unverified surfaces** (no flow covers them — candidates for future
flows): scanner camera→match→`MatchReviewSheet` pipeline (needs the
~140 MB model bundle plus a card/fixture), `OrganizerScreen`
(requires an `is_organizer` account), `EventSearchScreen` filters
(needs a downloaded event catalog), `ShowVendorScreen` upload/publish,
`EditAssetModal`, `DealAnalysisSheet`, cart drawer, `SetupGate` image
pack step, and `SubscriptionGate`/`PricingPreview`. Maestro Cloud /
CI E2E is deliberately un-budgeted — see `.devin/WORK_QUEUE.md`
Deferred.

## Workers

Three Cloudflare Workers deploy by hand from the **repo root** (there is
no root `package.json` — wrangler is global/`npx`):

| Config | Entry point | Worker name | Public hostname |
| --- | --- | --- | --- |
| `wrangler.jsonc` | `worker.js` | `pokequant` | `pokequant.totees-mart.workers.dev` |
| `wrangler.pre_show.jsonc` | `worker_pre_show.js` | `pokequant-pre-show` | `pokequant-pre-show.totees-mart.workers.dev` |
| `wrangler.show_vendor.jsonc` | `worker_show_vendor.js` | `pokequant-vendor` | `pokequant-vendor.totees-mart.workers.dev` |

- `pokequant` is the tenant-sync gateway — `CLOUDFLARE_WORKER_URL` in
  `src/constants/api.ts` points every install's
  `inventory`/`vendor_settings`/`sync_metadata` egress at it. It also
  still serves the legacy PWA.
- `pokequant-vendor` is the authenticated show-vendor API
  (`worker_show_vendor.js` only re-exports
  `worker_show_vendor/dispatch.js`; handlers live in `worker_show_vendor/`).
- `pokequant-pre-show` is the public fetch-only snapshot worker; it
  writes `shows/{showId}/event_catalog.json.zip` to the `pokequant-db`
  R2 bucket via the `EVENT_CATALOG_BUCKET` binding declared in its jsonc.

**Deploy** (from repo root, one command per worker):

```powershell
npx wrangler deploy --config wrangler.jsonc
npx wrangler deploy --config wrangler.pre_show.jsonc
npx wrangler deploy --config wrangler.show_vendor.jsonc
```

**Environment checklist** — set secrets with
`npx wrangler secret put <NAME> --config <cfg>`; never commit them to a
jsonc:

- `pokequant`: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (required).
- `pokequant-pre-show`: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
  (required). `EVENT_CATALOG_BUCKET` is a declared R2 binding, not a
  secret.
- `pokequant-vendor`: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY` (required by `POST
  /vendor/delete-account`), `REVENUECAT_SECRET_API_KEY` (subscription
  reconciliation), `REVENUECAT_WEBHOOK_SECRET` (`POST
  /revenuecat-webhook`). `SUPABASE_ANON_KEY` is optional and falls back
  to the service-role key.
- `SUPABASE_URL` / `SUPABASE_JWKS_URL` are optional overrides on the two
  authenticated workers; unset, they derive the JWKS endpoint from the
  hardcoded project URL (`jglvrozjhfooohkbmmwe.supabase.co`).

**Invariants:**

- `TURSO_DATABASE_URL` must be `https://<db>.turso.io` — `libsql://`
  cannot be resolved by `fetch()`.
- Auth is ES256 JWTs verified via Web Crypto against the Supabase JWKS
  endpoint (5-minute key cache). Never revert to HS256, RS256, or
  symmetric HMAC.
- `wrangler.pre_show.jsonc` sets `preview_urls: false`; keep it off —
  show snapshots must only come from the versioned worker deployment.

**Deploy order:** when a commit touches both a worker and app code that
pins against it, deploy the worker BEFORE an app build ships. The
`__tests__` characterization suites pin the repo file, not the deployed
revision — re-run the suite post-deploy to confirm the live worker
matches what was pinned.

**Rollback:** `npx wrangler rollback --config <cfg>` returns to the
previous deployment, or redeploy the worker file from the prior commit.

## Git hooks

`tools/hooks/pre-push` is an opt-in local gate mirroring the
`mobile-ci.yml` path filter: a push whose range touches
`PokeQuantMobile/**`, `worker*.js`, `worker_show_vendor/**`, or
`mobile-ci.yml` runs `npm run verify` before leaving; PWA-only pushes
skip it. The hook is **not wired by default** — enabling it is a
per-clone `git config` change, run from the repo root:

```powershell
git config core.hooksPath PokeQuantMobile/tools/hooks
```

The path is repo-root-relative — `tools/hooks` alone resolves wrong
because no top-level `tools/` directory exists. It requires a POSIX sh
(Git Bash provides one on Windows). Remove with
`git config --unset core.hooksPath`.

## Dependency updates

No dependabot/renovate and no audit gate — updates are manual and
deliberate. Triage `npm audit` + `npm outdated` output before acting;
most audit noise is dev/build-time chains (jest, metro, babel,
`@expo/config-*`), not code that ships in the app bundle.

**Ownership rules:**

- **`expo install` owns the SDK-managed surface** — `expo`, every
  `expo-*`, `babel-preset-expo`, `jest-expo`, `eslint-config-expo`,
  `react`, `react-native`, `@types/react`, `react-native-screens`,
  `react-native-safe-area-context`, `react-native-svg`. Bump these only
  through `npx expo install --fix` against the SDK's expected versions;
  a full SDK move (57 → 58) is its own queue item with an EAS build.
- **Non-SDK `^`/`~` ranges bump via `npm update <pkg>`** — it moves the
  lockfile within the declared range without editing the spec. Out-of-
  range majors are explicit spec edits with their own review.
- **Patched packages are frozen until the patch expires.** Two
  `patch-package` patches must be re-verified on every version bump of
  their target:
  1. `@dariyd+react-native-text-recognition+2.0.20.patch` — Gradle
     `uri("file://…")` → `File.toURI()` in `build.gradle` (maven-publish
     resolution fix).
  2. `react-native-fast-tflite+3.0.1.patch` — copies the JS
     `ArrayBuffer` into a native-owned buffer so TFLite can read model
     weights off the Nitro invoke thread.
  Checklist per bump: `patch-package` still applies cleanly on a fresh
  `npm install`; upstream has or has not shipped the fix (if shipped,
  drop the `.patch` file); EAS build + device smoke on the affected
  path (OCR / scan inference).
- **drizzle rides the RC line deliberately.** `drizzle-orm` and
  `drizzle-kit` are pinned `^1.0.0-rc.4`; the `0.4x` stable line is a
  different API lineage — do not "fix" back to it. Track `rc.5+` / 1.0
  final and bump orm+kit as a pair, then re-verify
  `drizzle/migrations.js` output.
- **`expo.install.exclude` (`expo-splash-screen`) and the
  `expo.doctor` exclusion (`react-native-fast-tflite`) are deliberate
  pins** — doctor keeps flagging them; that is expected, not a fix
  target.

**Triage buckets (audit summary, 2026-10-18 — 68 remaining, 0
critical):**

- *Deferred — need a build/device pass:* `react-native-zip-archive`
  9.5.3 (in-range, native zip path); native majors
  (`async-storage` 3.x, `@sentry/react-native` 8.x,
  `react-native-purchases(-ui)` 10.14, safe-area-context 5.10,
  screens 4.30, svg 15.16, flash-list 2.3); the SDK-58 family
  (expo 58, jest-expo 58 + jest 30, babel/eslint-config-expo 58,
  RN 0.88, react 19.3); `typescript` 7, `eslint` 10; drizzle rc.5;
  `@dariyd` 2.0.21 (patched).
- *Wontfix — dev-only or bogus downgrade:* `braces`/`micromatch` glob
  DoS via jest/metro/eslint/ts-prune/patch-package (fixes are jest 30,
  patch-package 6.x, or ts-prune 0.3 downgrades — none real);
  `node-forge` via expo-updates code-signing (fix wants
  expo-updates@0.11.7, an SDK-45-era downgrade; resolves on SDK bump);
  `sprintf-js`/`argparse`/`js-yaml`/`babel-plugin-istanbul` (jest
  coverage plumbing); `uuid`/`xcode` via `@expo/config-plugins`
  (prebuild-time plist tooling; "fixes" are splash/sharing downgrades);
  `@sentry/react-native` flagged "via expo" (peer-range artifact).

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
