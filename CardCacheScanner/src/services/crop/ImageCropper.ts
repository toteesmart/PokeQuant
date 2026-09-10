import { loadImage, type Image } from 'react-native-nitro-image';
import { detectCard, type BBox, type DetectionResult } from '../detection/CardDetector';

const GUIDE_ASPECT = 2.5 / 3.5;

export type CropResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
};

export async function cropImage(fullImage: Image): Promise<CropResult> {
  const detection = await detectCard(fullImage).catch((e) => {
    console.warn('Card detection failed; using guide fallback', e);
    return null;
  });

  const bbox = detection?.bbox ?? computeGuideCrop(fullImage.width, fullImage.height);
  const startX = Math.max(0, Math.round(bbox.x - bbox.width / 2));
  const startY = Math.max(0, Math.round(bbox.y - bbox.height / 2));
  const endX = Math.min(fullImage.width, Math.round(bbox.x + bbox.width / 2));
  const endY = Math.min(fullImage.height, Math.round(bbox.y + bbox.height / 2));

  const cropped = await fullImage.cropAsync(startX, startY, endX, endY);
  const filePath = await cropped.saveToTemporaryFileAsync('jpg', 95);

  return {
    uri: `file://${filePath}`,
    detection,
    usedGuideFallback: detection === null,
  };
}

export async function cropCard(imageFilePath: string): Promise<CropResult> {
  const fullImage = await loadImage({ filePath: imageFilePath });
  return cropImage(fullImage);
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
