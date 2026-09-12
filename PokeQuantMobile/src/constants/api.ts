export const CLOUDFLARE_WORKER_URL =
  'https://pokequant.totees-mart.workers.dev';

export const CATALOG_DOWNLOAD_URL =
  'https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev/mobile_catalog.db';

export const CATALOG_IMAGES_ZIP_URL =
  'https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev/catalog_images.zip';

export const CATALOG_IMAGE_BASE =
  'https://tcgplayer-cdn.tcgplayer.com/product';

export const INVENTORY_IMAGE_BASE =
  'https://images.tcgplayer.com/condition/500';

export const R2_PUBLIC_HOST =
  'https://pub-81d2f5a4ba9a4821bc03f0c3375f9536.r2.dev';

export function getEventCatalogUrl(showId: string): string {
  return `${R2_PUBLIC_HOST}/shows/${showId}/event_catalog.json.zip`;
}

export const SCANNER_DETECTOR_MODEL_URL =
  `${R2_PUBLIC_HOST}/scanner/card_detector.tflite`;

export const SCANNER_EMBEDDER_MODEL_URL =
  `${R2_PUBLIC_HOST}/scanner/mobileclip_s2_image_fp16.tflite`;

export const SCANNER_SIDECAR_MANIFEST_URL =
  `${R2_PUBLIC_HOST}/scanner/catalog_embeddings/manifest.json`;

export const SCANNER_SIDECAR_BIN_URL =
  `${R2_PUBLIC_HOST}/scanner/catalog_embeddings/embeddings.bin`;

export const SHOW_VENDOR_WORKER_URL =
  'https://pokequant-vendor.totees-mart.workers.dev';

export function getShowTriggerUrl(showId: string): string {
  return `https://pokequant-pre-show.totees-mart.workers.dev/trigger/${showId}`;
}

export const SYNC_BATCH_SIZE = 500;
