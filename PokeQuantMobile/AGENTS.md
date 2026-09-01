# PokeQuantMobile Agent Rules

## Monorepo Isolation

When working on the React Native / Expo mobile app, your scope is strictly confined to the `PokeQuantMobile/` directory. Never modify files in the monorepo root such as `app.py`, `sw.js`, `card_tool.py`, `index.html`, `worker.js`, or the root `AGENTS.md` / `global_rules.md`. If a mobile task requires changes to shared cloud or web infrastructure, surface the dependency to the user instead of editing root files.

## UI Thread Performance

You must never block the React Native JavaScript thread with synchronous, long-running work. Heavy inventory formatting, price calculations, or catalog hydration must be:

- Chunked into small batches (e.g., 50–100 items at a time).
- Deferred to `requestIdleCallback`/`setTimeout` or native module threads where appropriate.
- Avoided inside render methods and `useEffect` cleanup that would re-trigger during navigation.

## Database Architecture

All local data persistence in the Expo app must use `expo-sqlite`. The mobile app will connect to a local `pokequant.db` bundled or created on first launch. Data should be read through a thin SQLite wrapper and streamed to the UI via React hooks (`useState`, `useEffect`, custom `useQuery` hooks) so the interface remains responsive during large reads.

## No Web Hacking

The mobile app is a native iOS/Android build. Do not use WebAssembly, IndexedDB, Pyodide, browser Service Workers, or Streamlit/JS bridging workarounds inside the Expo app. Use native Expo and React Native primitives for storage, networking, and rendering.

## Verification Commands

After running `npm install` (or using the full-path `npm` equivalent), `node` and `npm` are not on the system `PATH` in this environment. Use the following command from `PokeQuantMobile/` to run the TypeScript type checker:

```powershell
& "C:\Program Files\nodejs\node.exe" node_modules\typescript\bin\tsc --noEmit
```
