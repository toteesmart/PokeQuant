import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';

export type ScanDebugInfo = {
  cropConfidence: number | null;
  usedGuideFallback: boolean;
  topText: string;
  bottomText: string;
  numberText: string | null;
  method: string | null;
  confidence: number | null;
  autoConfirm: boolean;
};

type Props = {
  top: number;
  info: ScanDebugInfo | null;
};

export function OcrDebugPanel({ top, info }: Props) {
  return (
    <View style={[styles.debugPanel, { top }]}>
      <Text style={styles.debugTitle}>Scan debug</Text>
      {info ? (
        <>
          <Text style={styles.debugText}>
            Crop conf: {info.cropConfidence?.toFixed(2) ?? 'n/a'}
            {info.usedGuideFallback ? ' (guide fallback)' : ''}
          </Text>
          <Text style={styles.debugText}>
            Number: {info.numberText ?? '—'}
          </Text>
          <Text style={styles.debugText}>
            Method: {info.method ?? '—'} · conf{' '}
            {info.confidence?.toFixed(2) ?? '—'} · autoConfirm{' '}
            {info.autoConfirm ? 'yes' : 'no'}
          </Text>
          <Text style={styles.debugText} numberOfLines={4}>
            Top: {info.topText || '—'}
          </Text>
          <Text style={styles.debugText} numberOfLines={4}>
            Bottom: {info.bottomText || '—'}
          </Text>
        </>
      ) : (
        <Text style={styles.debugText}>No scan yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  debugPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(10,12,15,0.9)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  debugText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
    fontFamily: 'monospace',
  },
});
