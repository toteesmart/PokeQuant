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
      <Text style={styles.debugTitle}>Scan diagnostics</Text>
      {info ? (
        <>
          <Text style={styles.debugText}>
            Card found: {info.cropConfidence?.toFixed(2) ?? 'n/a'}
            {info.usedGuideFallback ? ' (guide box used)' : ''}
          </Text>
          <Text style={styles.debugText}>
            Number read: {info.numberText ?? '—'}
          </Text>
          <Text style={styles.debugText}>
            Matched by: {info.method ?? '—'} · sure{' '}
            {info.confidence?.toFixed(2) ?? '—'} · auto-added{' '}
            {info.autoConfirm ? 'yes' : 'no'}
          </Text>
          <Text style={styles.debugText} numberOfLines={4}>
            Top text: {info.topText || '—'}
          </Text>
          <Text style={styles.debugText} numberOfLines={4}>
            Bottom text: {info.bottomText || '—'}
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
    backgroundColor: colors.scrimDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  debugText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
    fontFamily: 'monospace',
  },
});
