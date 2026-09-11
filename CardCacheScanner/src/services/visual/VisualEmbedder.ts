import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Images } from 'react-native-nitro-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { RawPixelData } from 'react-native-nitro-image';

// MobileCLIP-S2 vision encoder in TFLite fp16.
// Input: 224x224 NHWC, pixels in [0, 1].
// Output: 512-d feature vector (not pre-normalized).
const VISUAL_INPUT_SIZE = 224;
const VISUAL_INPUT_FLOATS = VISUAL_INPUT_SIZE * VISUAL_INPUT_SIZE * 3;
const VISUAL_OUTPUT_SIZE = 512;

// MobileCLIP S2 preprocess uses mean=[0,0,0], std=[1,1,1] => just scale to [0,1].
function normalize(pixel: number): number {
  return pixel / 255.0;
}

declare global {
  // eslint-disable-next-line no-var
  var __visualEmbedderModelPromise: Promise<TensorflowModel> | undefined;
  // eslint-disable-next-line no-var
  var __visualEmbedderInputFloats: Float32Array | undefined;
}

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

  for (let dy = 0; dy < VISUAL_INPUT_SIZE; dy++) {
    const srcY = Math.min(height - 1, Math.floor(dy * (height / VISUAL_INPUT_SIZE)));
    const rowOffset = srcY * rowBytes;
    for (let dx = 0; dx < VISUAL_INPUT_SIZE; dx++) {
      const srcX = Math.min(width - 1, Math.floor(dx * (width / VISUAL_INPUT_SIZE)));
      const [r, g, b] = getRgb(rowOffset + srcX * channels);
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
  console.log('VisualEmbedder: resize start', uri);
  const resized = await manipulateAsync(uri, [
    { resize: { width: VISUAL_INPUT_SIZE, height: VISUAL_INPUT_SIZE } },
  ], {
    compress: 0.95,
    format: SaveFormat.JPEG,
  });
  console.log('VisualEmbedder: resize done', resized.uri);

  const image = await Images.loadFromFileAsync(stripFileScheme(resized.uri));
  const raw = await image.toRawPixelData();
  console.log('VisualEmbedder: raw done', raw.width, raw.height, raw.pixelFormat);

  if (!globalThis.__visualEmbedderInputFloats) {
    globalThis.__visualEmbedderInputFloats = new Float32Array(VISUAL_INPUT_FLOATS);
  }
  const inputFloats = globalThis.__visualEmbedderInputFloats;
  inputFloats.fill(0);
  convertAndNormalize(raw, inputFloats);
  console.log('VisualEmbedder: normalize done');

  const model = await getModel();
  console.log('VisualEmbedder: model run start');
  const outputs = await model.run([inputFloats.buffer as ArrayBuffer]);
  console.log('VisualEmbedder: model run done');

  const embedding = new Float32Array(outputs[0]! as ArrayBuffer).slice(0, VISUAL_OUTPUT_SIZE);
  console.log('VisualEmbedder: raw output', embedding.length, embedding[0].toFixed(4), embedding[1].toFixed(4));

  (image as any).dispose?.();

  return l2Normalize(embedding);
}
