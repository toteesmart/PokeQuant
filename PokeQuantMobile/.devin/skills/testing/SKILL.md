---
name: testing
description: Writing Jest tests for PokeQuantMobile — hook suites (renderHook, debounce flush, partial mocks), store tests, and the worker_show_vendor characterization harness. Load before adding or modifying anything under __tests__/.
---

# Testing — Card Cache

Jest + jest-expo preset. Suites live in `PokeQuantMobile/__tests__/*.test.ts`; shared helpers in `__tests__/helpers/` (excluded from test discovery via `testPathIgnorePatterns`). Iterate with `npx jest __tests__/<name>.test.ts`; green bar is `npm test` + `npm run typecheck` + `npm run lint`.

## Hook harness (`helpers/renderHook.ts`)

`@testing-library/react-native` is not installed — use the local `react-test-renderer` wrapper:

```ts
import { flushAsync, renderHook } from './helpers/renderHook';

const { result, rerender, unmount } = renderHook((p: Props) => useMyHook(p), props);
```

- `result.current` re-read after every `act`/`flushAsync`; the TestComponent renders `null`.
- `flushAsync()` = `await act(async () => setTimeout(0))` — drains pending promise chains without fake timers.
- **Auto-unmount invariant:** every mounted harness unmounts in `afterEach`. Never leave a hook alive across tests — store-only changes re-fire its effects and pollute call counts.
- Wrap anything that touches React state in `act(...)`: invoking hook-returned methods, and `useXStore.setState(...)` while a mounted hook subscribes to that store.

**Real-timer debounce flush.** Search hooks debounce ~250ms of *real* time. Never `jest.useFakeTimers` — park just past the window inside `act`:

```ts
const flushSearch = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  });
```

Also use a shorter park (e.g. 100ms) to assert *nothing* fired inside the debounce window, and that a retype restarts the clock.

## `jest.setup.js` — already mocked, do NOT re-mock

These are hoisted for every suite because they either fail to parse under jest or touch native modules:

- `react-native-purchases` — resolves to its ESM browser build under jest and fails to parse. Drive entitlements through `useSubscriptionStore.setState({ customerInfo: mkCustomerInfo([...]) })`, never this module.
- `@expo/vector-icons` — Proxy returning `Icon-<Name>` string stubs (it imports `expo-font` → `expo-asset`, which is native-only).
- `@react-navigation/native` — real module spread with a `useFocusEffect` stand-in: `useEffect(() => callback(), [callback])`, so it fires once per stable callback (the load-on-focus moment). **Caveat:** a hook that rebuilds its focus callback every render re-fires on each render — keep the callback memoized like the tested hooks do.
- `expo-sqlite` (`openDatabaseSync` jest.fn), `expo-secure-store`, `@react-native-async-storage/async-storage`, `expo-file-system` (`Paths`/`Directory`/`File` stubs — `File#exists` defaults `false`), `react-native-zip-archive`, `expo-image-manipulator`, vision-camera / fast-tflite / nitro-image / text-recognition.

To vary a setup-level mock per suite, spy on it — don't add another `jest.mock` for the same module.

## Per-suite mock patterns

**Full mock** for pure service seams the hook calls:

```ts
jest.mock('../src/services/showVendorService', () => ({
  updateShow: jest.fn(),
  updateShowRegistration: jest.fn(),
}));
```

**Partial mock** (`requireActual` spread) to cut specific seams while keeping the rest of the module real — used for `catalogDb`, `eventCatalogDb`, `database`, `inventoryDb`, `importRows`:

```ts
jest.mock('../src/db/eventCatalogDb', () => {
  const actual = jest.requireActual<typeof import('../src/db/eventCatalogDb')>(
    '../src/db/eventCatalogDb'
  );
  return {
    ...actual,
    searchEventInventory: jest.fn(),   // seam only
  };
});
```

**`requireActual` handle for SQL-layer pins.** The mocked namespace shadows the export; pull the real one to run it against a fake DB in a dedicated `describe` — the "pin at the implementation" layer:

```ts
const realSearchEventInventory = jest.requireActual<
  typeof import('../src/db/eventCatalogDb')
>('../src/db/eventCatalogDb').searchEventInventory;
```

Collect typed handles once at module top: `const mockX = jest.mocked(x)`.

## Seams you'll reuse

- **`Alert.alert`:** `jest.spyOn(Alert, 'alert').mockImplementation(() => {})`. To "press" a button: read `AlertButton[]` from `alertSpy.mock.calls.at(-1)![2]`, find by `text`, `await act(async () => button.onPress?.())`.
- **`File` gates:** `jest.spyOn(File.prototype, 'exists', 'get').mockReturnValue(true)` — getter spy, the third arg `'get'` is required. For file contents: `jest.spyOn(File.prototype, 'base64').mockResolvedValue(...)`.
- **Fake expo-sqlite handle:** bare object cast `as unknown as SQLiteDatabase` with jest.fns for `getFirstAsync`/`getAllSync`/`runSync`/`execSync`/`closeSync`/`withTransactionSync((fn) => fn())`; `jest.mocked(openDatabaseSync).mockReturnValue(fakeDb)`. If the code only passes the handle through, a bare `{}` sentinel keeps identity checks honest.
- **Zustand stores:** seed with `useXStore.setState({...})` (inside `act` when a mounted hook subscribes); pure store tests call `useXStore.getState().action()` and assert on `getState()`.
- **Module-state resets:** some modules carry caches — e.g. `clearEventImageMatchCache()` + `closeEventImageDb()` in `beforeEach`. Check the module for exported reset helpers before writing flaky tests around them.
- `jest.clearAllMocks()` in `beforeEach` everywhere.

## Builders convention (`helpers/builders.ts`)

`mk*(over: Partial<T> = {}): T` factories returning one canonical shape with `...over` last — `mkSignal`, `mkFeatures`, `mkShow`, `mkVendorProfile`, `mkCustomerInfo` (drives RevenueCat by entitlement ids only), `mkInventoryCard`, `mkCatalogCard`, `mkEventItem`, `mkVendorShow`, `mkReg`, `mkSelection`. Reused across suites — add new shared builders here; keep worker-schema row builders file-local (see `workerShowVendor.test.ts`).

## Worker characterization harness (`helpers/workerHarness.ts`)

For repo-root `worker_*.js` (outside this package — `jest.config.js` `moduleNameMapper` maps `@babel/runtime/*` so the transformed require resolves).

- `FakeTurso` — stateful in-memory `/v2/pipeline`: regex routes over normalized SQL covering only the statement shapes the worker emits; unmatched SQL falls through to an empty result (schema bootstrap harmlessly no-ops). API: `seed(table, rows)`, `setConfig`, `override(re, fn)` (per-test route, tried first), `failOnce(re, msg)`, plus `matching(re)` / `writesTo(table)` for SQL pins. Supports `?` args, literals, `excluded.col`, `COALESCE`, `IN`/`LIKE`/comparisons, upsert `WHERE excluded.col > t.col` (LWW).
- **Auth is real.** `beforeAll`: `key = await makeSigningKey()` (native `crypto.subtle` ES256 keypair). `signJwt(key, defaultClaims({sub, ...}))`, `unsignedJwt({payload})` for malformed cases. `installFetch(db, { jwks: [key.jwk] })` in `beforeEach` routes JWKS/Turso/RevenueCat/Supabase-admin; unmocked URLs return 599.
- `callWorker(path, { method, token, body, env })` → `{ status, body, headers }`. `makeEnv()` gives `TURSO_*`/`SUPABASE_*`.
- Silence `console.error/warn/log` in `beforeAll` — the worker logs every handled error path by design.
- **Ethos:** pin observed behavior as-is. If a test reveals a real bug, pin the buggy behavior and report — never fix production code inside a characterization pass.

## Pinning doctrine

Two layers, deliberately split:

1. **Hook-level pins** capture the *payload handed to the seam* — assert args verbatim (`toHaveBeenCalledWith(db, {query: "Farfetch'd - ex", ...}, 50, 0)`). Normalization lives in the DB layer, so raw text reaching the seam is the contract.
2. **Implementation pins** run the real function against a fake DB (the `requireActual` handle) to pin SQL text, row→model mapping, and numeric thresholds (e.g. the fuzzy-match score-150 boundary, `bulkInsertInventory` insert mapping).

Also pin: ordering via `mock.invocationCallOrder`, optimistic flags during the debounce window (`isSearching` claims up front), error → notice-not-crash, modal-stays-open on failure.

**Gotcha:** reject promises with plain strings, not `Error` — they survive `toErrorMessage` verbatim; `Error('x')` produces the joined string `'x Error Error: x'`.

## Fixture hydration (`helpers/hydrate.ts`)

Mirrors `catalogDb`'s row→model mapping (`signalFromRow`, `deepFromRow`, price series, pattern stats) for `__tests__/fixtures/realCards.json`. If a catalog column is added pipeline-side, update the matching `hydrate*` function — it's the one place the fixture mapping learns about it.
