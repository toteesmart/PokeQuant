import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { useProgressStore } from '../store/progressStore';
import { ensureCatalogDownloaded } from '../services/CatalogDownloadService';
import {
  catalogImagesReady,
  ensureCatalogImagesDownloaded,
  warmCatalogImageIndex,
} from '../services/CatalogImageService';

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
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    // Warm the image index behind the gate so the (potentially slow)
    // directory scan never blocks a screen the user is looking at.
    await warmCatalogImageIndex().catch((err) =>
      console.warn('Image index warm-up failed:', err)
    );
    advancePastCatalog();
  }, [advancePastCatalog]);

  const downloadImages = useCallback(async () => {
    setError(null);
    setStep('images');
    try {
      await ensureCatalogImagesDownloaded();
      await warmCatalogImageIndex();
      setStep('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      ? 'Checking card catalog...'
      : 'Downloading card images...';
  const label =
    (step === 'images' ? imageLabel : catalogLabel) || defaultLabel;

  return (
    <View style={styles.container}>
      <Ionicons name="albums-outline" size={48} color={colors.primary} />
      <Text style={styles.title}>Setting up your catalog</Text>
      <Text style={styles.subtitle}>
        One-time setup — everything is stored on this device for offline use.
      </Text>

      {step === 'images-choice' ? (
        <View style={styles.choiceBox}>
          <Text style={styles.choiceTitle}>Download offline card images?</Text>
          <Text style={styles.choiceBody}>
            Downloads every card image once (~1.8 GB) so cards show photos
            everywhere — inventory, search, and shows — without a connection.
            You can skip and do this later from Settings.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.primaryButton}
            onPress={downloadImages}>
            <Text style={styles.primaryButtonText}>
              {error ? 'Retry download' : 'Download image pack'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.secondaryButton}
            onPress={() => setStep('ready')}>
            <Text style={styles.secondaryButtonText}>Skip for now</Text>
          </TouchableOpacity>
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
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.primaryButton}
                  onPress={bootstrap}>
                  <Text style={styles.primaryButtonText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.secondaryButton}
                  onPress={advancePastCatalog}>
                  <Text style={styles.secondaryButtonText}>
                    Continue offline
                  </Text>
                </TouchableOpacity>
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
    fontSize: 20,
    fontWeight: 'bold',
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
    borderRadius: 3,
    backgroundColor: colors.surface,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
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
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: 'bold',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
