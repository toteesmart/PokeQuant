// useCatalogDb — catalog lifecycle: auto-download trigger, open-once
// guard, and the download progress/status copy for the loading state.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { openCatalogDatabase } from '../db/catalogDb';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
import { useProgressStore } from '../store/progressStore';
import { logError, toErrorMessage } from '../utils/log';

export function useCatalogDb() {
  const [catalogDb, setCatalogDb] = useState<SQLiteDatabase | null>(null);
  const [isCatalogReady, setIsCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const catalogOpenedRef = useRef(false);

  const progressIsCatalogReady = useProgressStore((state) => state.isCatalogReady);
  const isExtracting = useProgressStore((state) => state.isExtracting);
  const catalogDownloadProgress = useProgressStore((state) => state.catalogDownloadProgress);
  const catalogDownloadPhase = useProgressStore((state) => state.catalogDownloadPhase);
  const imageDownloadProgress = useProgressStore((state) => state.imageDownloadProgress);
  const imageDownloadPhase = useProgressStore((state) => state.imageDownloadPhase);
  const isDownloadingImages = useProgressStore((state) => state.isDownloadingImages);

  const { downloadProgress, downloadStatus } = useMemo(() => {
    if (catalogDownloadPhase === 'download' && (isExtracting || catalogDownloadProgress > 0)) {
      const pct = Math.round(catalogDownloadProgress * 100);
      return {
        downloadProgress: catalogDownloadProgress,
        downloadStatus: `Downloading price list: ${pct}%`,
      };
    }

    if (
      isDownloadingImages &&
      (imageDownloadPhase === 'download' || imageDownloadPhase === 'extract')
    ) {
      const pct = Math.round(imageDownloadProgress * 100);
      return {
        downloadProgress: imageDownloadProgress,
        downloadStatus:
          imageDownloadPhase === 'extract'
            ? `Unpacking card photos: ${pct}%`
            : `Downloading card photos: ${pct}%`,
      };
    }

    if (catalogDownloadPhase === 'complete' || imageDownloadPhase === 'complete') {
      return { downloadProgress: 1, downloadStatus: 'Price list ready.' };
    }

    if (isExtracting) {
      return { downloadProgress: 0, downloadStatus: 'Unpacking price list...' };
    }

    return { downloadProgress: 0, downloadStatus: 'Opening price list...' };
  }, [
    catalogDownloadPhase,
    catalogDownloadProgress,
    imageDownloadPhase,
    imageDownloadProgress,
    isDownloadingImages,
    isExtracting,
  ]);

  useEffect(() => {
    // If the catalog is missing and we aren't already fetching it, start the download automatically
    if (!progressIsCatalogReady && !isExtracting) {
      ensureCatalogDownloaded().catch((err) => {
        logError('Auto-download failed:', err);
      });
    }
  }, [progressIsCatalogReady, isExtracting]);

  useEffect(() => {
    // If extracting or not globally ready, reset the guard so it can trigger later
    if (isExtracting || !progressIsCatalogReady) {
      catalogOpenedRef.current = false;
      return;
    }

    if (catalogOpenedRef.current) return;
    catalogOpenedRef.current = true;

    let mounted = true;

    openCatalogDatabase()
      .then((db) => {
        if (!mounted) return;
        setCatalogDb(db);
        setCatalogError(null);
        setIsCatalogReady(true);
      })
      .catch((err) => {
        if (mounted) {
          setCatalogError(toErrorMessage(err));
        }
        catalogOpenedRef.current = false;
      });
    return () => {
      mounted = false;
    };
  }, [isExtracting, progressIsCatalogReady]);

  return {
    catalogDb,
    isCatalogReady,
    catalogError,
    downloadProgress,
    downloadStatus,
  };
}
