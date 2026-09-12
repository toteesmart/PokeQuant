import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Images } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';
import { detectCard, type DetectionResult } from './detection/CardDetector';
import { computeGuideCrop } from './crop/guideCrop';
import { recognizeTextFromImage, type OcrResult } from './ocr/TextRecognition';
import {
  hydrateVariantPrices,
  loadScannerCatalog,
} from './catalog/ScannerCatalogProvider';
import {
  findBestMatch,
  extractCardNameFromOcr,
  catalogName,
  bestNameScore,
  nameFilter,
  findVariantOptions,
  nameAgrees,
  cleanCardName,
  findNearNumberCandidates,
  type CatalogMatch,
} from './catalog/catalogMatcher';
import type { ScanCatalogCard } from '../types/catalog';
import { normalizeNumber, extractCardNumber } from '../utils/normalizeText';
import { getEmbeddingFromUri } from './visual/VisualEmbedder';
import {
  startPrecompute,
  loadBinarySidecar,
  type EmbeddingMap,
} from './visual/EmbeddingCache';
import { findVisualMatches, type VisualMatch } from './visual/visualMatcher';
import { fuseConfidence, type FusionResult } from './fusion/confidenceFusion';

const MODEL_INPUT_SIZE = 640;

export type VariantOption = {
  card: ScanCatalogCard;
  score: number | null;
};

export type ProcessPhotoResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
  ocr: OcrResult | null;
  match: CatalogMatch | null;
  visualMatches: VisualMatch[];
  variantOptions: VariantOption[];
  otherMatches: CatalogMatch[];
  queryEmbedding: Float32Array | null;
  fusion: FusionResult;
};

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function getLogicalDimensions(photo: Photo): { width: number; height: number } {
  const { width, height, orientation } = photo;
  if (orientation === 'right' || orientation === 'left') {
    return { width: height, height: width };
  }
  return { width, height };
}

export async function processPhoto(photo: Photo): Promise<ProcessPhotoResult> {
  console.log('processPhoto: save start', photo.width, photo.height, photo.orientation);
  const photoPath = await photo.saveToTemporaryFileAsync();
  const fullUri = `file://${photoPath}`;
  const logical = getLogicalDimensions(photo);
  (photo as any).dispose?.();
  console.log('processPhoto: save done', photoPath, 'logical', logical.width, logical.height);

  // Create a 640×640 model input (stretched; the card fills the frame).
  console.log('processPhoto: resize start');
  const resized = await manipulateAsync(fullUri, [
    { resize: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE } },
  ], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  console.log('processPhoto: resize done', resized.uri);

  // Load the small file and read raw pixels for TFLite.
  // Keep the Image alive until detection is done because toRawPixelData() may
  // return a view into the Image's native pixel buffer.
  console.log('processPhoto: raw start');
  const smallImage = await Images.loadFromFileAsync(stripFileScheme(resized.uri));
  const smallRaw = await smallImage.toRawPixelData();
  console.log('processPhoto: raw done', smallRaw.pixelFormat, smallRaw.buffer.byteLength);

  console.log('processPhoto: detect start');
  const detection = await detectCard(smallRaw).catch((e) => {
    console.warn('processPhoto: detection failed; using guide fallback', e);
    return null;
  });
  console.log('processPhoto: detect done', detection);

  // Dispose the small Image only after the raw pixel view is no longer needed.
  (smallImage as any).dispose?.();

  const bbox = detection?.bbox ?? computeGuideCrop(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const scaleX = logical.width / MODEL_INPUT_SIZE;
  const scaleY = logical.height / MODEL_INPUT_SIZE;

  const originX = Math.max(0, Math.round((bbox.x - bbox.width / 2) * scaleX));
  const originY = Math.max(0, Math.round((bbox.y - bbox.height / 2) * scaleY));
  const cropWidth = Math.min(logical.width - originX, Math.round(bbox.width * scaleX));
  const cropHeight = Math.min(logical.height - originY, Math.round(bbox.height * scaleY));

  console.log('processPhoto: crop start', originX, originY, cropWidth, cropHeight);
  const cropped = await manipulateAsync(fullUri, [
    { crop: { originX, originY, width: cropWidth, height: cropHeight } },
  ], {
    compress: 0.95,
    format: SaveFormat.JPEG,
  });
  console.log('processPhoto: crop done', cropped.width, cropped.height, cropped.uri);

  console.log('processPhoto: ocr start');
  const ocrStart = Date.now();

  // Focused OCR is faster and usually sufficient (top for name, bottom for number).
  const [topOcr, bottomOcr] = await Promise.all([
    runFocusedOcr(cropped, 'top'),
    runFocusedOcr(cropped, 'bottom'),
  ]);

  let topText = topOcr?.fullText ?? '';
  let bottomText = bottomOcr?.fullText ?? '';
  let fullOcr: OcrResult | null = null;
  let fullText = '';

  const nameFromTop = extractCardNameFromOcr(topText);
  const numberFromBottom = extractCardNumber(bottomText);

  // Only run the slow full-card OCR if the focused cuts didn't give usable text.
  if (!nameFromTop || !numberFromBottom) {
    fullOcr = await recognizeTextFromImage(cropped.uri).catch((e) => {
      console.warn('processPhoto: full ocr failed', e);
      return null;
    });
    console.log('processPhoto: full ocr done', fullOcr?.fullText?.slice(0, 120));
    fullText = fullOcr?.fullText ?? '';
  }

  const combinedText = [fullText, topText, bottomText].filter(Boolean).join(' ');
  // Prefer the focused bottom-left number, but fall back to full text.
  const numberText = numberFromBottom
    ?? extractCardNumber(fullText)
    ?? extractCardNumber(combinedText)
    ?? extractCardNumber(topText);

  const ocr: OcrResult | null = {
    fullText: combinedText,
    blocks: fullOcr?.blocks ?? [],
    topText,
    bottomText,
    numberText,
  };
  console.log('processPhoto: ocr done in', Date.now() - ocrStart, 'ms number', numberText);

  console.log('processPhoto: catalog match start');
  const catalog = await loadScannerCatalog();
  const matchStart = Date.now();
  // The focused top strip yields a short, clean card name; feeding the whole
  // card text to the matcher explodes token combinations and is much slower.
  // 'ex'/'gx' suffixes can be missed on the strip, so borrow them from the
  // combined text when present (e.g. "Vaporeon" -> "Vaporeon ex").
  const topName = extractCardNameFromOcr(topText);
  let ocrName = topName ?? extractCardNameFromOcr(combinedText);
  if (ocrName && !ocrName.split(' ').includes('ex')) {
    const combinedTokens = new Set(cleanCardName(combinedText).split(' '));
    if (combinedTokens.has('ex')) ocrName += ' ex';
    else if (combinedTokens.has('gx')) ocrName += ' gx';
  }
  const match = ocr
    ? findBestMatch(ocrName ?? combinedText, numberText, catalog)
    : null;
  console.log('processPhoto: catalog match done in', Date.now() - matchStart, 'ms', match?.card.name, match?.confidence, match?.method);

  // Narrow visual search to cards the OCR points at. This keeps dot products small
  // and prevents unrelated color-similar cards (e.g. Hydreigon) from dominating.
  const name = ocrName;
  const normalizedNumber = numberText ? normalizeNumber(numberText) : null;
  const byName = name
    ? nameFilter(name, catalog).filter(
        (c) => bestNameScore(name, catalogName(c)) >= 0.4
      )
    : [];
  let visualCatalog = catalog;
  if (normalizedNumber) {
    const byNumber = catalog.filter((c) => normalizeNumber(c.number) === normalizedNumber);
    if (byNumber.length > 0) {
      // If the OCR name agrees with none of the same-number cards, the number
      // was probably misread — narrow by name instead of poisoning visual
      // search.
      const agrees =
        !name || byNumber.some((c) => nameAgrees(name, catalogName(c)));
      if (agrees) {
        visualCatalog = byNumber;
      } else if (byName.length > 0 && byName.length < 500) {
        visualCatalog = byName;
      }
      // Weak number reads ("013/217" for "113/217") still miss the real card
      // — pull one-digit-off same-total cards into the pool so it can surface
      // as a visual/other-match option. Clean number+name scans keep the
      // tight pool.
      const weakNumber =
        !agrees || (match?.method === 'number' && match.confidence <= 0.5);
      if (weakNumber && visualCatalog !== catalog) {
        const seen = new Set(visualCatalog.map((c) => c.productId));
        for (const c of findNearNumberCandidates(numberText!, catalog)) {
          if (!seen.has(c.productId)) visualCatalog.push(c);
        }
      }
    }
  } else if (byName.length > 0 && byName.length < 500) {
    visualCatalog = byName;
  }
  console.log('processPhoto: visual catalog', visualCatalog.length, 'cards');

  console.log('processPhoto: visual embedding start');
  let queryEmbedding: Float32Array | null = null;
  let visualMatches: VisualMatch[] = [];
  let visualMatchCandidates: VisualMatch[] = [];
  try {
    queryEmbedding = await getEmbeddingFromUri(cropped.uri);
    // The sidecar loads in the background from screen mount — awaiting joins
    // the in-flight promise so the first scan keeps visual matching instead
    // of silently skipping it.
    startPrecompute(catalog);
    const embeddings = await loadBinarySidecar().catch(() => null);
    if (embeddings && embeddings.size > 0) {
      visualMatchCandidates = findVisualMatches(queryEmbedding, visualCatalog, embeddings, 20);
      visualMatches = visualMatchCandidates.slice(0, 3);
      console.log(
        'processPhoto: visual matches',
        visualMatchCandidates.map((m) => `${m.card.name} ${m.score.toFixed(3)}`).join(', ')
      );
    } else {
      console.log('processPhoto: visual index still building');
    }
  } catch (e) {
    console.warn('processPhoto: visual embedding failed', e);
  }

  // Refine the text match to the best visual candidate within the same
  // name/number set. This disambiguates variants (e.g. the 4 "Vaporeon ex - 023/131" cards).
  let refinedMatch = match;
  if (match && visualMatchCandidates.length > 0) {
    const top = visualMatchCandidates[0];
    const nameScore = name ? bestNameScore(name, catalogName(top.card)) : 0;
    const sameNumber =
      match.method === 'number' &&
      normalizeNumber(top.card.number) === normalizeNumber(match.card.number);
    const sameName = match.method === 'name' && nameScore >= Math.max(0.5, match.confidence - 0.2);
    if (sameNumber || sameName) {
      refinedMatch = { card: top.card, method: match.method, confidence: match.confidence };
    }
  }

  const fusionRaw = fuseConfidence(refinedMatch, visualMatchCandidates);

  // Same-card printings (same name, any productIds) are often visually
  // near-identical — a tiny score gap cannot tell them apart, whether they
  // share a collector number or are reprints of the same art. When the top
  // candidate and the best same-name alternative anywhere in the list are
  // that close, require user confirmation instead of auto-adding the wrong
  // printing.
  const topV = visualMatchCandidates[0];
  const samePrintingAlt = topV
    ? visualMatchCandidates.slice(1).find(
        (v) =>
          catalogName(v.card).split(' ')[0] ===
          catalogName(topV.card).split(' ')[0]
      )
    : undefined;
  const variantAmbiguous =
    !!topV && !!samePrintingAlt && topV.score - samePrintingAlt.score < 0.06;
  if (variantAmbiguous && fusionRaw.autoConfirm) {
    console.log(
      'processPhoto: variant ambiguity, manual confirm',
      topV.score.toFixed(3),
      samePrintingAlt!.score.toFixed(3)
    );
  }
  const fusion: FusionResult = {
    ...fusionRaw,
    autoConfirm: fusionRaw.autoConfirm && !variantAmbiguous,
  };
  console.log(
    'processPhoto: fusion top',
    fusion.top?.card.name,
    fusion.top?.confidence.toFixed(3),
    'autoConfirm',
    fusion.autoConfirm
  );

  // Suggest the fused top match — but when it only marginally beats the
  // OCR/catalog match, prefer the catalog match: number/name evidence is more
  // reliable than a visual-only candidate on a noisy crop.
  const matchFused = refinedMatch
    ? fusion.candidates.find(
        (c) => c.card.productId === refinedMatch.card.productId
      ) ?? null
    : null;
  const preselectMatch =
    matchFused &&
    fusion.top &&
    fusion.top.confidence - matchFused.confidence < 0.1
      ? matchFused
      : fusion.top ?? null;

  // Same name+number catalog variants (e.g. regular vs Prize Pack printings)
  // for every fused candidate the user might switch to — the catalog match's
  // variants must stay reachable even when fusion.top is a different card.
  const scoreByProduct = new Map(
    visualMatchCandidates.map((m) => [m.card.productId, m.score])
  );
  const variantById = new Map<number, VariantOption>();
  for (const candidate of fusion.candidates.slice(0, 8)) {
    for (const card of findVariantOptions(candidate.card, catalog)) {
      if (!variantById.has(card.productId)) {
        variantById.set(card.productId, {
          card,
          score: scoreByProduct.get(card.productId) ?? null,
        });
      }
    }
  }
  const variantOptions = [...variantById.values()];

  // Other candidates worth showing: the catalog match itself (number/name
  // evidence stays reachable even when a visual-only card outranks it), any
  // same-number alternates the OCR name could not disambiguate (e.g. Eevee ex
  // vs Rockruff both numbered 075/131), plus fused candidates near the top
  // score, deduped by cleaned name.
  const topConf = fusion.top?.confidence ?? 0;
  const seenNames = new Set<string>();
  const otherMatches: CatalogMatch[] = [];
  if (matchFused && matchFused.card.productId !== fusion.top?.card.productId) {
    otherMatches.push(matchFused);
    seenNames.add(catalogName(matchFused.card));
  }
  for (const candidate of [refinedMatch, preselectMatch]) {
    for (const alt of candidate?.alternates ?? []) {
      if (alt.productId === fusion.top?.card.productId) continue;
      if (alt.productId === matchFused?.card.productId) continue;
      if (otherMatches.some((o) => o.card.productId === alt.productId)) continue;
      const key = catalogName(alt);
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      otherMatches.push({ card: alt, method: 'number', confidence: 0.5 });
    }
  }
  for (const candidate of fusion.candidates) {
    if (otherMatches.length >= 5) break;
    if (candidate.card.productId === fusion.top?.card.productId) continue;
    if (candidate.card.productId === matchFused?.card.productId) continue;
    if (candidate.confidence < topConf - 0.12) break;
    const key = catalogName(candidate.card);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    otherMatches.push(candidate);
  }

  // Hydrate display prices for every card the review sheet can surface.
  // The catalog build skips price_history entirely (a full-table GROUP BY
  // costs seconds); this single indexed query covers ~30 ids in ms.
  try {
    const seen = new Set<number>();
    const priceCards = [
      ...fusion.candidates.map((c) => c.card),
      ...variantOptions.map((v) => v.card),
      ...otherMatches.map((m) => m.card),
    ].filter((c) => {
      if (seen.has(c.productId)) return false;
      seen.add(c.productId);
      return true;
    });
    await hydrateVariantPrices(priceCards);
  } catch (e) {
    console.warn('processPhoto: price hydration failed', e);
  }

  return {
    uri: cropped.uri,
    detection,
    usedGuideFallback: detection === null,
    ocr,
    match: preselectMatch,
    visualMatches,
    variantOptions,
    otherMatches,
    queryEmbedding,
    fusion,
  };
}

type FocusConfig = {
  height: number;
  originY: number;
  width: number;
  targetHeight: number;
  recognitionLevel: 'word' | 'line' | 'block';
};

function getFocusConfig(image: { width: number; height: number }, region: 'top' | 'bottom'): FocusConfig {
  if (region === 'top') {
    const h = Math.round(image.height * 0.08);
    const originY = Math.round(image.height * 0.06);
    return {
      height: h,
      originY,
      width: image.width,
      targetHeight: h * 3,
      recognitionLevel: 'line',
    };
  }
  // Bottom-left where the collector number lives.
  const h = Math.round(image.height * 0.12);
  const originY = Math.max(0, image.height - h);
  return {
    height: h,
    originY,
    // Crop to bottom-left 55% to avoid copyright/HP/retreat text on the right.
    width: Math.round(image.width * 0.55),
    targetHeight: h * 4,
    recognitionLevel: 'word',
  };
}

async function runFocusedOcr(
  image: { uri: string; width: number; height: number },
  region: 'top' | 'bottom'
) {
  const config = getFocusConfig(image, region);

  try {
    const focused = await manipulateAsync(image.uri, [
      { crop: { originX: 0, originY: config.originY, width: config.width, height: config.height } },
      { resize: { height: config.targetHeight } },
    ], {
      compress: 0.95,
      format: SaveFormat.JPEG,
    });
    console.log(`processPhoto: ${region} focus ocr start`, focused.width, focused.height);
    const result = await recognizeTextFromImage(focused.uri, config.recognitionLevel);
    console.log(`processPhoto: ${region} focus ocr done`, result?.fullText?.slice(0, 120));
    return result;
  } catch (e) {
    console.warn(`processPhoto: ${region} focus ocr failed`, e);
    return null;
  }
}
