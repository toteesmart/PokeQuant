import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { AppButton } from '../../components/ui';
import { useProgressStore } from '../../store/progressStore';
import { ensureScannerAssets } from '../services/ScannerAssetService';
import { toErrorMessage } from '../../utils/log';

type Props = {
  onReady: () => void;
  onCancel: () => void;
};

// One-time download of the scanner models + embeddings sidecar (~141 MB).
// Mirrors SetupGate's image-pack step: explicit, skippable, and the scanner
// is fully offline afterwards.
export function ScannerDownloadGate({ onReady, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const progress = useProgressStore((s) => s.scannerDownloadProgress);
  const label = useProgressStore((s) => s.scannerDownloadLabel);
  const isDownloading = useProgressStore((s) => s.isDownloadingScannerAssets);

  const download = useCallback(async () => {
    setError(null);
    try {
      await ensureScannerAssets();
      onReady();
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [onReady]);

  // Auto-start once — a re-render with a new inline onReady must not re-fire
  // download() (it clears a displayed error and silently retries). Deferred
  // one tick so download()'s setError reset stays out of the effect body.
  const didAutoStart = useRef(false);
  useEffect(() => {
    if (didAutoStart.current) return;
    didAutoStart.current = true;
    const t = setTimeout(() => {
      void download();
    }, 0);
    return () => clearTimeout(t);
  }, [download]);

  return (
    <View style={styles.container}>
      <Ionicons name="scan-outline" size={48} color={colors.primary} />
      <Text style={styles.title}>Setting up card scanner</Text>
      <Text style={styles.subtitle}>
        One-time download (~140 MB) — the card detector and image matcher are saved on this phone,
        so scanning works without internet.
      </Text>

      <View style={styles.progressBox}>
        {isDownloading ? <ActivityIndicator color={colors.primary} size="large" /> : null}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          {label || 'Preparing download...'}
          {progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : ''}
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {error ? (
        <AppButton title="Retry download" onPress={download} style={styles.retryButton} />
      ) : null}
      <AppButton
        title={error ? 'Back' : 'Cancel'}
        variant="ghost"
        onPress={onCancel}
        style={styles.cancelButton}
      />
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
  retryButton: {
    marginTop: 20,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  cancelButton: {
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
});
