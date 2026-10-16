import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { scannerScreenStyles as styles } from './scannerScreenStyles';

/** Matcher warm-up banner — scanning still works, the first one just
 *  joins the in-flight load. Non-interactive so it can't eat taps. */
export function WarmingPill({ top }: { top: number }) {
  return (
    <View style={[styles.warmingPill, { top }]} pointerEvents="none">
      <ActivityIndicator size="small" color={colors.textMuted} />
      <Text style={styles.warmingText}>Warming up the card scanner…</Text>
    </View>
  );
}

/** Processing indicator — without this a multi-second first scan reads
 *  as a frozen app. */
export function ProcessingOverlay({ isCropping }: { isCropping: boolean }) {
  return (
    <View style={styles.processingOverlay} pointerEvents="none">
      <View style={styles.processingCard}>
        <ActivityIndicator color={colors.primary} size="small" />
        <Text style={styles.processingText}>{isCropping ? 'Reading the card…' : 'Capturing…'}</Text>
      </View>
    </View>
  );
}
