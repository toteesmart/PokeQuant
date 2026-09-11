import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Images } from 'react-native-nitro-image';
import type { RawPixelData } from 'react-native-nitro-image';

// MobileCLIP-S2 vision encoder in TFLite fp16.
// Input: 224x224 NHWC, pixels in [0, 1].
// Output: 512-d feature vector (not pre-normalized).
const VISUAL_INPUT_SIZE = 224;
const VISUAL_INPUT_FLOATS = VISUAL_INPUT_SIZE * VISUAL_INPUT_SIZE * 3;
const VISUAL_OUTPUT_SIZE = 512;

// Crop to the card art region to avoid matching on borders, holofoil glare,
// and text. For a standard Pokémon card, the artwork sits just below the
// stage banner and above the name/HP bar.
const ART_CROP_TOP = 0.08;
const ART_CROP_BOTTOM = 0.55;

function normalize(pixel: number): number {
  return pixel / 255.0;
}

declare global {
  // eslint-disable-next-line no-var
  var __visualEmbedderModelPromise: Promise<TensorflowModel> | undefined;
}

let embeddingQueue: Promise<unknown> = Promise.resolve();

function getModel(): Promise<TensorflowModel> {
  if (!globalThis.__visualEmbedderModelPromise) {
    console.log('VisualEmbedder: loading MobileCLIP-S2 TFLite model from asset');
    globalThis.__visualEmbedderModelPromise = loadTensorflowModel(
      // @ts-ignore - .tflite is a Metro asset
      require('../../../assets/models/mobileclip_s2_image_fp16.tflite'),
      []
    );
  } else {
    console.log('VisualEmbedder: reusing cached TFLite model');
  }
  return globalThis.__visualEmbedderModelPromise;
}

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function convertAndNormalize(
  raw: RawPixelData,
  target: Float32Array
): void {
  const { width, height, pixelFormat, buffer } = raw;
  const src = new Uint8Array(buffer);

  const getRgb = (offset: number): [number, number, number] => {
    switch (pixelFormat) {
      case 'RGB':
        return [src[offset], src[offset + 1], src[offset + 2]];
      case 'BGR':
        return [src[offset + 2], src[offset + 1], src[offset]];
      case 'RGBA':
        return [src[offset], src[offset + 1], src[offset + 2]];
      case 'BGRA':
        return [src[offset + 2], src[offset + 1], src[offset]];
      case 'ARGB':
        return [src[offset + 1], src[offset + 2], src[offset + 3]];
      case 'ABGR':
        return [src[offset + 3], src[offset + 2], src[offset + 1]];
      case 'RGBX':
        return [src[offset], src[offset + 1], src[offset + 2]];
      case 'BGRX':
        return [src[offset + 2], src[offset + 1], src[offset]];
      case 'XRGB':
        return [src[offset + 1], src[offset + 2], src[offset + 3]];
      case 'XBGR':
        return [src[offset + 3], src[offset + 2], src[offset + 1]];
      default:
        return [src[offset], src[offset + 1], src[offset + 2]];
    }
  };

  const channels = pixelFormat === 'RGB' || pixelFormat === 'BGR' ? 3 : 4;
  const rowBytes = width * channels;

  const cropTop = ART_CROP_TOP * height;
  const cropBottom = ART_CROP_BOTTOM * height;
  const cropHeight = cropBottom - cropTop;
  const cropWidth = width;

  // Match MobileCLIP's training preprocessing: resize the art so the shortest
  // edge is 224, then center-crop the longer edge to 224.
  const scale = VISUAL_INPUT_SIZE / cropHeight;
  const scaledWidth = cropWidth * scale;
  const xOffset = (scaledWidth - VISUAL_INPUT_SIZE) / 2;

  for (let dy = 0; dy < VISUAL_INPUT_SIZE; dy++) {
    for (let dx = 0; dx < VISUAL_INPUT_SIZE; dx++) {
      const srcX = (xOffset + dx) / scale;
      const srcY = dy / scale + cropTop;

      const clampedX = Math.max(0, Math.min(width - 1, Math.floor(srcX)));
      const clampedY = Math.max(0, Math.min(height - 1, Math.floor(srcY)));

      const rowOffset = clampedY * rowBytes;
      const [r, g, b] = getRgb(rowOffset + clampedX * channels);
      const outIdx = (dy * VISUAL_INPUT_SIZE + dx) * 3;
      target[outIdx + 0] = normalize(r);
      target[outIdx + 1] = normalize(g);
      target[outIdx + 2] = normalize(b);
    }
  }
}

function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= norm;
  }
  return vector;
}

export async function getEmbeddingFromUri(uri: string): Promise<Float32Array> {
  const next = embeddingQueue.then(async () => {
    console.log('VisualEmbedder: load start', uri);
    const image = await Images.loadFromFileAsync(stripFileScheme(uri));
    const raw = await image.toRawPixelData();
    // Copy pixel data before disposing the native image to avoid use-after-free.
    const rawCopy: RawPixelData = {
      width: raw.width,
      height: raw.height,
      pixelFormat: raw.pixelFormat,
      buffer: raw.buffer.slice(0),
    };
    (image as any).dispose?.();
    console.log('VisualEmbedder: raw done', rawCopy.width, rawCopy.height, rawCopy.pixelFormat);

    const inputFloats = new Float32Array(VISUAL_INPUT_FLOATS);
    convertAndNormalize(rawCopy, inputFloats);
    console.log('VisualEmbedder: normalize done');

    const model = await getModel();
    console.log('VisualEmbedder: model run start');
    const outputs = await model.run([inputFloats.buffer as ArrayBuffer]);
    console.log('VisualEmbedder: model run done');

    const embedding = new Float32Array(outputs[0]! as ArrayBuffer).slice(0, VISUAL_OUTPUT_SIZE);
    console.log('VisualEmbedder: raw output', embedding.length, embedding[0].toFixed(4), embedding[1].toFixed(4));

    if (Number.isNaN(embedding[0])) {
      throw new Error('VisualEmbedder: model produced NaN output');
    }

    return l2Normalize(embedding);
  });

  embeddingQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}
