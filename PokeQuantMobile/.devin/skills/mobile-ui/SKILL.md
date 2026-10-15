---
name: mobile-ui
description: Card Cache mobile UI work — screens, components, styles, layout, navigation, visual polish. Load whenever changing anything the user sees.
---

# Mobile UI — Card Cache

## Source of truth
1. `PokeQuantMobile/docs/design/UI_PRINCIPLES.md` — tokens, conventions, interaction contract, agentic-surface rules.
2. `PokeQuantMobile/AGENTS.md` — Invariants section (FlashList v2 discipline, expo-image, bounded lists — physics, never negotiable).
3. `PokeQuantMobile/src/constants/colors.ts` + `theme.ts` — the token layer. Never hardcode hex/rgba literals in components.

## Required workflow for ANY UI change
1. Implement using tokens + conventions (no raw hex/rgba/fontSize/borderRadius literals outside the scale).
2. `cd PokeQuantMobile && npm run lint:ui` — must pass with zero violations.
3. `npx tsc --noEmit` + `npx jest` — must stay green.
4. If a device/emulator is attached (`adb devices`), run `maestro test maestro/flows/` and read the PNGs in `artifacts/ui-screens/` — verify the change renders correctly.
5. Spawn the `ui-verifier` subagent on the diff before reporting done to the user.
