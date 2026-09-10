import { Images, type Image, type RawPixelData } from 'react-native-nitro-image';
import { detectCard, type BBox, type DetectionResult } from '../detection/CardDetector';

const GUIDE_ASPECT = 2.5 / 3.5;

export type CropResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
};

function getBgraChannels(format: RawPixelData['pixelFormat']): number {
  return format === 'RGB' || format === 'BGR' ? 3 : 4;
}

function extractCropRaw(raw: RawPixelData, bbox: BBox): RawPixelData {
  const { width, height, pixelFormat, buffer } = raw;
  const src = new Uint8Array(buffer);
  const channels = getBgraChannels(pixelFormat);
  const rowBytes = width * channels;

  const startX = Math.max(0, Math.round(bbox.x - bbox.width / 2));
  const startY = Math.max(0, Math.round(bbox.y - bbox.height / 2));
  const endX = Math.min(width, Math.round(bbox.x + bbox.width / 2));
  const endY = Math.min(height, Math.round(bbox.y + bbox.height / 2));
  const cropWidth = endX - startX;
  const cropHeight = endY - startY;

  const cropBuffer = new ArrayBuffer(cropWidth * cropHeight * channels);
  const dst = new Uint8Array(cropBuffer);

  for (let y = 0; y < cropHeight; y++) {
    const srcRowOffset = (startY + y) * rowBytes + startX * channels;
    const dstRowOffset = y * cropWidth * channels;
    const row = src.subarray(srcRowOffset, srcRowOffset + cropWidth * channels);
    dst.set(row, dstRowOffset);
  }

  return {
    buffer: cropBuffer,
    width: cropWidth,
    height: cropHeight,
    pixelFormat,
  };
}

export async function cropImage(raw: RawPixelData): Promise<CropResult> {
  console.log('ImageCropper: detect start');
  const detection = await detectCard(raw).catch((e) => {
    console.warn('Card detection failed; using guide fallback', e);
    return null;
  });
  console.log('ImageCropper: detect done', detection);

  const bbox = detection?.bbox ?? computeGuideCrop(raw.width, raw.height);
  const cropRaw = extractCropRaw(raw, bbox);

  console.log('ImageCropper: loadFromRawPixelData start');
  const cropped = await Images.loadFromRawPixelDataAsync(cropRaw);
  console.log('ImageCropper: loadFromRawPixelData done');
  console.log('ImageCropper: save start');
  const filePath = await cropped.saveToTemporaryFileAsync('jpg', 95);
  console.log('ImageCropper: save done');

  // The cropped image is small and fully saved; it is safe to dispose.
  (cropped as any).dispose?.();

  return {
    uri: `file://${filePath}`,
    detection,
    usedGuideFallback: detection === null,
  };
}

export async function cropCard(imageFilePath: string): Promise<CropResult> {
  const fullImage = await Images.loadFromFileAsync(imageFilePath);
  try {
    const raw = await fullImage.toRawPixelData();
    return await cropImage(raw);
  } finally {
    (fullImage as any).dispose?.();
  }
}

export function computeGuideCrop(imageWidth: number, imageHeight: number): BBox {
  const width = Math.min(imageWidth * 0.85, imageHeight * GUIDE_ASPECT * 0.85);
  const height = width / GUIDE_ASPECT;
  const x = (imageWidth - width) / 2;
  const y = (imageHeight - height) / 2;
  return {
    x: x + width / 2,
    y: y + height / 2,
    width,
    height,
  };
}
