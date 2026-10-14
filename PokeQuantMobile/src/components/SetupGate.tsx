import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { AppButton } from './ui';
import { useProgressStore } from '../store/progressStore';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
import {
  catalogImagesReady,
  ensureCatalogImagesDownloaded,
  ensureJpImagesDownloaded,
  warmCatalogImageIndex,
} from '../services/CatalogImageService';
import { ensureScannerAssets } from '../scanner/services/ScannerAssetService';
import { toErrorMessage } from '../utils/log';

type Step = 'catalog' | 'images-choice' | 'images' | 'ready';

// First-run / launch bootstrap: verify the catalog DB, warm the extracted
// image index, then offer the (large) offline image pack as an explicit step.
// Everything here is device-scoped and idempotent — on a returning launch the
// catalog exists and the index warms from the manifest, so the gate passes in
// milliseconds. Re-login on the same device never re-downloads anything.
export function SetupGate({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>('catalog');
  const [error, setError] = useState<string | null>(null);

  const catalogProgress = useProgressStore((s) => s.catalogDownloadProgress);
  const catalogPhase = useProgressStore((s) => s.catalogDownloadPhase);
  const catalogLabel = useProgressStore((s) => s.catalogDownloadLabel);
  const imageProgress = useProgressStore((s) => s.imageDownloadProgress);
  const imagePhase = useProgressStore((s) => s.imageDownloadPhase);
  const imageLabel = useProgressStore((s) => s.imageDownloadLabel);

  const advancePastCatalog = useCallback(() => {
    setError(null);
    setStep(catalogImagesReady() ? 'ready' : 'images-choice');
  }, []);

  const bootstrap = useCallback(async () => {
    setError(null);
    setStep('catalog');
    try {
      await ensureCatalogDownloaded();
    } catch (err) {
      setError(toErrorMessage(err));
      return;
    }
    // Warm the image index behind the gate so the (potentially slow)
    // directory scan never blocks a screen the user is looking at.
    await warmCatalogImageIndex().catch((err) =>
      console.warn('Image index warm-up failed:', err)
    );
    advancePastCatalog();
  }, [advancePastCatalog]);

  const downloadImages = useCallback(async (withJapanese: boolean) => {
    setError(null);
    setStep('images');
    try {
      await ensureCatalogImagesDownloaded();
      if (withJapanese) {
        await ensureJpImagesDownloaded();
        // The JP embedding sidecar unlocks as soon as the JP image pack is
        // installed — fetch it in the background rather than holding setup.
        ensureScannerAssets().catch((e) =>
          console.warn('SetupGate: JP scanner assets failed', e)
        );
      }
      await warmCatalogImageIndex();
      setStep('ready');
    } catch (err) {
      setError(toErrorMessage(err));
      setStep('images-choice');
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (step === 'ready') {
    return <>{children}</>;
  }

  const activeProgress = step === 'images' ? imageProgress : catalogProgress;
  const activePhase = step === 'images' ? imagePhase : catalogPhase;
  const defaultLabel =
    step === 'catalog'
      ? 'Checking your price list...'
      : 'Downloading card photos...';
  const label =
    (step === 'images' ? imageLabel : catalogLabel) || defaultLabel;

  return (
    <View style={styles.container}>
      <Ionicons name="albums-outline" size={48} color={colors.primary} />
      <Text style={styles.title}>Setting up your price list</Text>
      <Text style={styles.subtitle}>
        One-time setup — everything is saved on this phone for use without
        internet.
      </Text>

      {step === 'images-choice' ? (
        <View style={styles.choiceBox}>
          <Text style={styles.choiceTitle}>Save card photos to this phone?</Text>
          <Text style={styles.choiceBody}>
            Stores card photos on this phone so they show everywhere —
            inventory, search, and shows — without internet. Adding Japanese
            also lets the scanner read Japanese cards. You can add either
            later from Settings.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <AppButton
            title={error ? 'Retry download' : 'English (~1.8 GB)'}
            onPress={() => downloadImages(false)}
          />
          <AppButton
            title="English + Japanese (~3.2 GB)"
            onPress={() => downloadImages(true)}
          />
          <AppButton
            title="Skip for now"
            variant="ghost"
            onPress={() => setStep('ready')}
          />
        </View>
      ) : (
        <View style={styles.progressBox}>
          <ActivityIndicator color={colors.primary} size="large" />
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(activeProgress * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {label}
            {activePhase === 'download' || activePhase === 'extract'
              ? ` ${Math.round(activeProgress * 100)}%`
              : ''}
          </Text>
          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <View style={styles.errorButtons}>
                <AppButton title="Retry" onPress={bootstrap} />
                <AppButton
                  title="Continue anyway"
                  variant="ghost"
                  onPress={advancePastCatalog}
                />
              </View>
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 20,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 19,
  },
  progressBox: {
    alignItems: 'center',
    width: '100%',
  },
  progressTrack: {
    width: '80%',
    height: 6,
    borderRadius: 4,
    backgroundColor: colors.overlay3,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  errorButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  choiceBox: {
    width: '100%',
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    padding: 20,
    gap: 10,
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  choiceBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
});
