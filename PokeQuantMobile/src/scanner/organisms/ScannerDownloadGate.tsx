import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { useProgressStore } from '../../store/progressStore';
import { ensureScannerAssets } from '../services/ScannerAssetService';

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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onReady]);

  useEffect(() => {
    download();
  }, [download]);

  return (
    <View style={styles.container}>
      <Ionicons name="scan-outline" size={48} color={colors.primary} />
      <Text style={styles.title}>Setting up card scanner</Text>
      <Text style={styles.subtitle}>
        One-time download (~140 MB) — the detection model, image matcher, and
        card embeddings are stored on this device so scanning works offline.
      </Text>

      <View style={styles.progressBox}>
        {isDownloading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : null}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>
          {label || 'Preparing download...'}
          {progress > 0 && progress < 1
            ? ` ${Math.round(progress * 100)}%`
            : ''}
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {error ? (
        <Pressable style={styles.primaryButton} onPress={download}>
          <Text style={styles.primaryButtonText}>Retry download</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.secondaryButton} onPress={onCancel}>
        <Text style={styles.secondaryButtonText}>
          {error ? 'Back' : 'Cancel'}
        </Text>
      </Pressable>
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 20,
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
