import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import type { Image } from 'react-native-nitro-image';

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectionResult = {
  confidence: number;
  bbox: BBox;
};

const MODEL_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const NUM_ANCHORS = 8400;

let modelPromise: Promise<TensorflowModel> | null = null;

function getModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(
      // @ts-ignore - .tflite is a Metro asset
      require('../../../assets/models/card_detector.tflite'),
      ['core-ml']
    ).catch((e) => {
      console.warn('CardDetector: core-ml delegate failed, trying CPU', e);
      return loadTensorflowModel(
        require('../../../assets/models/card_detector.tflite'),
        []
      );
    });
  }
  return modelPromise;
}

export async function detectCard(fullImage: Image): Promise<DetectionResult | null> {
  const resized = await fullImage.resizeAsync(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const raw = await resized.toRawPixelData();

  const inputFloats = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3);
  const src = new Uint8Array(raw.buffer);
  const format = raw.pixelFormat;

  const getRgb = (offset: number): [number, number, number] => {
    switch (format) {
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

  const channels = format === 'RGB' || format === 'BGR' ? 3 : 4;
  for (let i = 0; i < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; i++) {
    const [r, g, b] = getRgb(i * channels);
    inputFloats[i * 3 + 0] = r / 255.0;
    inputFloats[i * 3 + 1] = g / 255.0;
    inputFloats[i * 3 + 2] = b / 255.0;
  }

  const model = await getModel();
  const outputs = await model.run([inputFloats.buffer]);
  const result = new Float32Array(outputs[0]!);

  const candidates: Array<DetectionResult & { index: number }> = [];
  for (let a = 0; a < NUM_ANCHORS; a++) {
    const conf = result[4 * NUM_ANCHORS + a];
    if (conf > CONFIDENCE_THRESHOLD) {
      const cx = result[0 * NUM_ANCHORS + a];
      const cy = result[1 * NUM_ANCHORS + a];
      const w = result[2 * NUM_ANCHORS + a];
      const h = result[3 * NUM_ANCHORS + a];
      candidates.push({
        confidence: conf,
        bbox: { x: cx, y: cy, width: w, height: h },
        index: a,
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.confidence - a.confidence);

  const kept: DetectionResult[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed.has(candidates[i].index)) continue;
    kept.push({
      confidence: candidates[i].confidence,
      bbox: candidates[i].bbox,
    });
    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed.has(candidates[j].index)) continue;
      if (iou(candidates[i].bbox, candidates[j].bbox) > IOU_THRESHOLD) {
        suppressed.add(candidates[j].index);
      }
    }
  }

  if (kept.length === 0) return null;

  const best = kept[0];
  const scaleX = fullImage.width / MODEL_INPUT_SIZE;
  const scaleY = fullImage.height / MODEL_INPUT_SIZE;

  return {
    confidence: best.confidence,
    bbox: {
      x: best.bbox.x * scaleX,
      y: best.bbox.y * scaleY,
      width: best.bbox.width * scaleX,
      height: best.bbox.height * scaleY,
    },
  };
}

function iou(a: BBox, b: BBox): number {
  const ax1 = a.x - a.width / 2;
  const ay1 = a.y - a.height / 2;
  const ax2 = a.x + a.width / 2;
  const ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2;
  const by1 = b.y - b.height / 2;
  const bx2 = b.x + b.width / 2;
  const by2 = b.y + b.height / 2;

  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return inter / (areaA + areaB - inter + 1e-10);
}
