# CardCacheScanner — Agents

CardCacheScanner is a **standalone Expo SDK 57 / React Native 0.86.3 app** that scans physical Pokémon cards: camera capture → card detection → crop → OCR → catalog match → MobileCLIP visual match → confidence fusion → queue. It is built to be integrated into **PokeQuantMobile / Card Cache by Totees Mart** (`../PokeQuantMobile`) but runs and ships independently (`com.toteesmart.cardcachescanner`).

The authoritative behavioral rules live in `globalrulesscanner.md`. This file is the project map.

## App shape

- `App.tsx` — 3-tab shell (`scan` / `queue` / `catalog`), no navigation library. Boots `loadBinarySidecar()` + `loadFullCatalog()` before rendering; blocks on a loading screen until both are ready.
- `src/screens/ScannerScreen.tsx` — Collectr-style scanner: full-screen `CameraPreview`, top bar (back / title / debug gear), bottom overlay with hint bubble → last-added pill, queue `Total`, shutter + `Next`. Owns capture → `processPhoto` → review-sheet state, auto-adds to queue when `fusion.autoConfirm`, and holds a gear-toggleable debug overlay (crop confidence, extracted number, method, fused confidence, OCR top/bottom text).
- `src/screens/QueueScreen.tsx` — "Review Your Matches" list of queued `ScannedCard`s; per-row condition/quantity editing and card replacement (`replaceCard`).
- `src/screens/HomeScreen.tsx` — catalog browse tab over `TestCatalogProvider` (`assets/test_catalog.json`), 2-column grid. It reads the *test* catalog, not the full one.
- `src/molecules/MatchReviewSheet.tsx` — bottom sheet shown on every non-auto-confirmed scan: crop thumbnail, selected card header (name, set, number, method, confidence, market price), **Variants** rows (same normalized number + same base name), **Other matches** rows (different-name/cross-set candidates, ≤5), quantity stepper, condition selector, Retake/Confirm. Selecting any row swaps the card that `onConfirm` queues.
- `src/atoms/` — `CameraPreview`, `CardGuideOverlay` (on-screen card frame), `ShutterButton`.
- `src/molecules/CatalogCardItem.tsx` — catalog row (image + name + number/set + rarity + price).

## Scan pipeline (`src/services/`)

Single entry point: `processPhoto(photo)` in `src/services/scanner/processPhoto.ts`. Order of operations:

1. **Save + resize** — `photo.saveToTemporaryFileAsync()`, stretched 640×640 for the detector; logical dimensions come from `photo.orientation` (`right`/`left` swap w/h).
2. **Detect** — `detection/CardDetector.ts`: YOLO-style TFLite (`assets/models/card_detector.tflite`), 640² input, `CONFIDENCE_THRESHOLD 0.25`, `IOU_THRESHOLD 0.45`, 8400 anchors. Model promise is cached on `globalThis` so Fast Refresh doesn't double-load.
3. **Crop** — `crop/ImageCropper.ts`: bbox → pixel crop on the full-res photo (scale factors from logical dims). Fallback when detection fails: `computeGuideCrop` using `src/constants/guide.ts` (`GUIDE_ASPECT 2.5/3.5`, `GUIDE_WIDTH_FRACTION 0.85`, `GUIDE_CENTER_Y 0.4`).
4. **OCR** — `ocr/TextRecognition.ts` via `@dariyd/react-native-text-recognition`. Two focused strips run in parallel: **top** (height 8% at originY 6%, ×3 upscale, `line` level) for the card name, **bottom-left 55%** (bottom 12%, ×4 upscale, `word` level) for the collector number. Full-card OCR runs only when a strip yields nothing usable.
5. **Extract** — `extractCardNameFromOcr` / `extractCardNumber` (see global rules for the number grammar).
6. **Catalog match** — `catalog/catalogMatcher.ts` `findBestMatch(ocrName, numberText, catalog)` → `CatalogMatch { card, method: 'number'|'name'|'fuzzy'|'visual'|'fused', confidence, alternates? }`.
7. **Visual catalog narrowing** — exact-number cards when number is confident; name-filtered cards when number looks misread; `findNearNumberCandidates` (one-digit-off, same set total) added only when the number path is weak; full 31k catalog as last resort.
8. **Embed** — `visual/VisualEmbedder.ts`: MobileCLIP-S2 fp16 TFLite (`assets/models/mobileclip_s2_image_fp16.tflite`), 224² input, art-region crop (8%–55% of card height), bilinear resize, pixels [0,1], 512-d output, L2-normalized. Progressive NaN dampening (0.95 → 0.85 → 0.6). Serialized through `embeddingQueue`.
9. **Visual match** — `visual/visualMatcher.ts` `findVisualMatches(query, visualCatalog, embeddings, 20)`: embeddings are pre-normalized so cosine = dot; top-K heap.
10. **Fuse** — `fusion/confidenceFusion.ts` `fuseConfidence(textMatch, visualMatches)`: text weight 0.75 (number) / 0.55 (name) / 0.35 (other); `autoConfirm` when fused top ≥ 0.85.
11. **Post-gates in processPhoto** — visual refine of the text match within same name/number set; **variant ambiguity gate** (top visual vs best same-name alt < 0.06 → force manual); **catalog-match preference** (preselect `refinedMatch` when within 0.1 of `fusion.top`); builds `variantOptions` (per top-8 fused candidate via `findVariantOptions`) and `otherMatches` (catalog match + `alternates` + fused candidates within 0.12 of top, deduped by cleaned name, capped at 5).

`ProcessPhotoResult` carries `uri`, `detection`, `usedGuideFallback`, `ocr` (`topText`/`bottomText`/`numberText`/`combinedText`), `match` (the preselected suggestion), `visualMatches`, `variantOptions`, `otherMatches`, `queryEmbedding`, `fusion`.

## Catalog + embeddings (offline-first)

- `assets/full_catalog.json` — ~31,306 `TestCatalogCard`s (`productId`, `name`, `number`, `set`, `rarity`, `imageUrl`, `variants[].marketPrice`). Loaded once via `FullCatalogProvider.loadFullCatalog()`; `precomputeCatalogCache` warms name/number indexes. `TestCatalogProvider` loads the small `assets/test_catalog.json` used by the Catalog tab and tests.
- `assets/catalog_embeddings/` — binary sidecar: `manifest.json` (`dimension: 512`, `count: ~31,297`, `productIds[]`, `offsets[]`) + `embeddings.bin` (fp32 vectors). `loadBinarySidecar()` memory-maps via `Asset` → `File.arrayBuffer()` → `Float32Array.subarray` views into `Map<productId, Float32Array>`.
- `EmbeddingCache.ts` also has a JSON path (`visual_embeddings_v3.json`, ≤1000 vectors) that exists only for small/test catalogs — never used when the sidecar is loaded. `startPrecompute` is a no-op once `loadedFromBinarySidecar` covers the catalog.
- **Camera crops and catalog images use identical preprocessing** in `VisualEmbedder.convertAndNormalize` — same art crop, same resize, same normalization. Do not diverge them.

## State + types

- `src/store/scanQueueStore.ts` — Zustand queue: `add`, `remove`, `updateCondition`, `updateQuantity`, `replaceCard`, `clear`. In-memory only (no persistence yet).
- `src/types/scan.ts` — `ScannedCard` (productId, name, set, number, rarity, imageUrl, condition `NM|LP|MP|HP|DMG`, quantity, prices). Condition multipliers: NM 1.0 / LP 0.85 / MP 0.7 / HP 0.5 / DMG 0.3 against `variants[0].marketPrice`.
- `src/types/catalog.ts` — `TestCatalogCard`, `TestCatalogVariant`.

## Utils

- `src/utils/normalizeText.ts` — `normalizeText`, `normalizeNumber` (strips leading zeros so `006/012` == `6/12`; space-insensitive so `SVP 200` == `SVP200`), and `extractCardNumber` (pure — moved here from processPhoto specifically so Jest can test it without loading native modules).
- `src/utils/formatCurrency.ts`.

## Tools (`tools/`, Python)

- `build_embeddings.py` — builds the production sidecar from `../catalog_images` + `pokemon_tcg.db` (see root `AGENTS.md` for the exact command).
- `build_full_catalog.py` — regenerates `assets/full_catalog.json`.
- `copy_scanner_sidecar.py` — copies the production sidecar into `assets/catalog_embeddings/`.
- `test_sidecar.py` — validates a binary sidecar against `catalog_images` for a given productId.
- `find_missing_sidecar.py`, `parse_ips.py`, `patch_tflite.py` — sidecar gap checks / TFLite patching utilities.

## Config

- `metro.config.js` — registers `.tflite` and `.bin` asset types.
- `babel.config.js` — `babel-plugin-inline-import` (for JSON assets).
- `patches/react-native-fast-tflite+3.0.1.patch` — applied by `postinstall` via patch-package; required for the TFLite crash fixes. Do not delete.
- `jest.config.js` + `jest.setup.js` — jest-expo preset.

## Tests

- `__tests__/catalogMatcher.test.ts` — matching/extraction regression suite (same-number alternates, near-number candidates, junk-token promos, fuzzy-name guards, variant filtering).
- `__tests__/normalizeText.test.ts` — normalization + `extractCardNumber` cases.

## Known absences / TODO

- Queue is not persisted and does not yet write into PokeQuantMobile's `inventory` table — that integration is the next planned work.
- `HomeScreen` catalog tab is a simple browse view, not the production PokeQuantMobile catalog DB.
- No price lookup beyond `variants[0].marketPrice`.
