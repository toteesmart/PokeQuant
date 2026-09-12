import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Images } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';
import { detectCard, type DetectionResult } from '../detection/CardDetector';
import { computeGuideCrop } from '../crop/ImageCropper';
import { recognizeTextFromImage, type OcrResult } from '../ocr/TextRecognition';
import { loadFullCatalog } from '../catalog/FullCatalogProvider';
import {
  findBestMatch,
  extractCardNameFromOcr,
  catalogName,
  bestNameScore,
  type CatalogMatch,
} from '../catalog/catalogMatcher';
import { normalizeText } from '../../utils/normalizeText';
import { getEmbeddingFromUri } from '../visual/VisualEmbedder';
import { startPrecompute, getCurrentEmbeddings, type EmbeddingMap } from '../visual/EmbeddingCache';
import { findVisualMatches, type VisualMatch } from '../visual/visualMatcher';
import { fuseConfidence, type FusionResult } from '../fusion/confidenceFusion';

const MODEL_INPUT_SIZE = 640;

export type ProcessPhotoResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
  ocr: OcrResult | null;
  match: CatalogMatch | null;
  visualMatches: VisualMatch[];
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
  const catalog = await loadFullCatalog();
  const matchStart = Date.now();
  const match = ocr ? findBestMatch(topText, numberText, catalog) : null;
  console.log('processPhoto: catalog match done in', Date.now() - matchStart, 'ms', match?.card.name, match?.confidence, match?.method);

  // Narrow visual search to cards the OCR points at. This keeps dot products small
  // and prevents unrelated color-similar cards (e.g. Hydreigon) from dominating.
  const name = extractCardNameFromOcr(topText);
  const normalizedNumber = numberText ? normalizeText(numberText) : null;
  let visualCatalog = catalog;
  if (normalizedNumber) {
    const byNumber = catalog.filter((c) => normalizeText(c.number) === normalizedNumber);
    if (byNumber.length > 0) visualCatalog = byNumber;
  } else if (name) {
    const byName = catalog.filter((c) => bestNameScore(name, catalogName(c)) >= 0.6);
    if (byName.length > 0 && byName.length < 500) visualCatalog = byName;
  }
  console.log('processPhoto: visual catalog', visualCatalog.length, 'cards');

  console.log('processPhoto: visual embedding start');
  let queryEmbedding: Float32Array | null = null;
  let visualMatches: VisualMatch[] = [];
  let visualMatchCandidates: VisualMatch[] = [];
  try {
    queryEmbedding = await getEmbeddingFromUri(cropped.uri);
    // Kick off catalog precomputation in the background; do not block the
    // confirmation UI while it downloads and embeds all catalog images.
    startPrecompute(catalog);
    const embeddings = getCurrentEmbeddings();
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
      match.method === 'number' && normalizeText(top.card.number) === normalizedNumber;
    const sameName = match.method === 'name' && nameScore >= Math.max(0.5, match.confidence - 0.2);
    if (sameNumber || sameName) {
      refinedMatch = { card: top.card, method: match.method, confidence: match.confidence };
    }
  }

  const fusion = fuseConfidence(refinedMatch, visualMatchCandidates);
  console.log(
    'processPhoto: fusion top',
    fusion.top?.card.name,
    fusion.top?.confidence.toFixed(3),
    'autoConfirm',
    fusion.autoConfirm
  );

  // Always show the fused top match as the suggested candidate. The user still
  // has to confirm unless it reaches the auto-confirm threshold.
  const preselectMatch = fusion.top ?? null;

  return {
    uri: cropped.uri,
    detection,
    usedGuideFallback: detection === null,
    ocr,
    match: preselectMatch,
    visualMatches,
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

function extractCardNumber(text: string): string | null {
  // Collector number can be "023/131", "23/131", "023 / 131", "023 131" or
  // concatenated "023131".
  // We require a non-digit separator (slash or whitespace) so years like "2025"
  // don't get split into "20/25".
  const separatorPattern = /(\d{1,3})\s*(?:\/|\s)\s*(\d{2,3})/g;
  const concatPattern = /(\d{3})(\d{3})/g;

  const matches: Array<RegExpExecArray> = [
    ...Array.from(text.matchAll(separatorPattern)),
    ...Array.from(text.matchAll(concatPattern)),
  ];

  if (!matches.length) return null;

  // The collector number is usually the rightmost NNN/NNN pattern in the text.
  for (let i = matches.length - 1; i >= 0; i--) {
    const left = matches[i][1];
    const right = matches[i][2];
    if (!left || !right) continue;

    const leftNum = parseInt(left, 10);
    const rightNum = parseInt(right, 10);
    const leftPadded = left.padStart(3, '0');
    const rightPadded = right.padStart(3, '0');

    if (leftNum > rightNum) continue;
    if (rightNum < 30) continue; // Set totals are rarely below 30.

    return `${leftPadded}/${rightPadded}`;
  }

  return null;
}
