import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ImageDownloadPhase = 'download' | 'extract' | 'complete';

type ProgressState = {
  isDownloadingImages: boolean;
  imageDownloadProgress: number;
  imageDownloadLabel: string;
  imageDownloadPhase: ImageDownloadPhase;
  catalogLastUpdated: number | null;
  isExtracting: boolean;
  isCatalogReady: boolean;
};

type ProgressActions = {
  startImageDownload: () => void;
  setImageDownloadProgress: (progress: number, label?: string) => void;
  setImageDownloadExtracting: (progress?: number) => void;
  setImagesDownloaded: () => void;
  resetImageDownload: () => void;
  setCatalogLastUpdated: (timestamp: number) => void;
  setIsExtracting: (value: boolean) => void;
  setCatalogReady: (value: boolean) => void;
};

export const useProgressStore = create<ProgressState & ProgressActions>()(
  persist(
    (set) => ({
      isDownloadingImages: false,
      imageDownloadProgress: 0,
      imageDownloadLabel: '',
      imageDownloadPhase: 'download',
      catalogLastUpdated: null,
      isExtracting: false,
      isCatalogReady: false,

      startImageDownload: () =>
        set({
          isDownloadingImages: true,
          imageDownloadProgress: 0,
          imageDownloadLabel: 'Downloading Offline Images...',
          imageDownloadPhase: 'download',
        }),

      setImageDownloadProgress: (progress, label) =>
        set((state) => ({
          imageDownloadProgress: progress,
          imageDownloadLabel: label ?? state.imageDownloadLabel,
        })),

      setImageDownloadExtracting: (progress = 0) =>
        set({
          imageDownloadProgress: progress,
          imageDownloadLabel: 'Extracting Offline Images...',
          imageDownloadPhase: 'extract',
        }),

      setImagesDownloaded: () =>
        set({
          imageDownloadProgress: 1,
          imageDownloadLabel: 'Offline Images Ready',
          imageDownloadPhase: 'complete',
        }),

      resetImageDownload: () =>
        set({
          isDownloadingImages: false,
          imageDownloadProgress: 0,
          imageDownloadLabel: '',
          imageDownloadPhase: 'download',
        }),

      setCatalogLastUpdated: (timestamp) =>
        set({ catalogLastUpdated: timestamp }),

      setIsExtracting: (value) => set({ isExtracting: value }),
      setCatalogReady: (value) => set({ isCatalogReady: value }),
    }),
    {
      name: 'progress-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ catalogLastUpdated: state.catalogLastUpdated }),
    }
  )
);
