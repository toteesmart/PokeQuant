import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Images } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';
import { detectCard, type DetectionResult } from '../detection/CardDetector';
import { computeGuideCrop } from '../crop/ImageCropper';
import { recognizeTextFromImage, type OcrResult } from '../ocr/TextRecognition';

const MODEL_INPUT_SIZE = 640;

export type ProcessPhotoResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
  ocr: OcrResult | null;
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
  const fullOcr = await recognizeTextFromImage(cropped.uri).catch((e) => {
    console.warn('processPhoto: ocr failed', e);
    return null;
  });
  console.log('processPhoto: full ocr done', fullOcr?.fullText?.slice(0, 120));

  // Focused OCR on the top 15% (card name, HP) and bottom 15% (number).
  // Each is cropped then upscaled by 2x to help with tiny text on holofoil.
  const [topOcr, bottomOcr] = await Promise.all([
    runFocusedOcr(cropped, 'top'),
    runFocusedOcr(cropped, 'bottom'),
  ]);

  const combinedText = [fullOcr?.fullText, topOcr?.fullText, bottomOcr?.fullText]
    .filter((t): t is string => !!t)
    .join(' ');
  const topText = topOcr?.fullText ?? '';
  const bottomText = bottomOcr?.fullText ?? '';
  const numberText = extractCardNumber(combinedText);

  const ocr: OcrResult | null = fullOcr
    ? {
        fullText: combinedText,
        blocks: fullOcr.blocks,
        topText,
        bottomText,
        numberText,
      }
    : null;
  console.log('processPhoto: ocr done', numberText);

  return {
    uri: cropped.uri,
    detection,
    usedGuideFallback: detection === null,
    ocr,
  };
}

type FocusConfig = {
  height: number;
  originY: number;
  targetHeight: number;
  recognitionLevel: 'word' | 'line' | 'block';
};

function getFocusConfig(image: { width: number; height: number }, region: 'top' | 'bottom'): FocusConfig {
  if (region === 'top') {
    const h = Math.round(image.height * 0.12);
    return {
      height: h,
      originY: 0,
      targetHeight: h * 3,
      recognitionLevel: 'line',
    };
  }
  const h = Math.round(image.height * 0.15);
  return {
    height: h,
    originY: Math.max(0, image.height - h),
    targetHeight: h * 2,
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
      { crop: { originX: 0, originY: config.originY, width: image.width, height: config.height } },
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
  // Match patterns like "023/131", "23 / 131", "023 / 131", "0231 131" etc.
  const pattern = /(\d{1,3})\s*\/?\s*(\d{2,3})/g;
  const matches = text.match(pattern);
  if (!matches) return null;

  for (const match of matches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 5) {
      // Likely concatenated like "023131"
      const mid = Math.floor(digits.length / 2);
      const left = digits.slice(0, mid);
      const right = digits.slice(mid);
      return `${left}/${right}`;
    }
    if (/\d{1,3}\s*\/\s*\d{2,3}/.test(match)) {
      const [left, right] = match.split('/').map((s) => s.trim());
      if (left && right) return `${left}/${right}`;
    }
  }
  return null;
}
