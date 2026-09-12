import { GUIDE_ASPECT, GUIDE_CENTER_Y, GUIDE_WIDTH_FRACTION } from '../../constants/guide';

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Fallback crop matching the on-screen card guide — used when the TFLite
// detector fails or finds nothing.
export function computeGuideCrop(imageWidth: number, imageHeight: number): BBox {
  const width = Math.min(
    imageWidth * GUIDE_WIDTH_FRACTION,
    imageHeight * GUIDE_ASPECT * GUIDE_WIDTH_FRACTION
  );
  const height = width / GUIDE_ASPECT;
  return {
    x: imageWidth / 2,
    y: imageHeight * GUIDE_CENTER_Y,
    width,
    height,
  };
}
