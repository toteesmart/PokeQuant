import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Images } from 'react-native-nitro-image';
import type { Photo } from 'react-native-vision-camera';
import { detectCard, type DetectionResult } from '../detection/CardDetector';
import { computeGuideCrop } from '../crop/ImageCropper';

const MODEL_INPUT_SIZE = 640;

export type ProcessPhotoResult = {
  uri: string;
  detection: DetectionResult | null;
  usedGuideFallback: boolean;
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
  console.log('processPhoto: crop done', cropped.uri);

  return {
    uri: cropped.uri,
    detection,
    usedGuideFallback: detection === null,
  };
}
