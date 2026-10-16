import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { ShutterButton } from '../atoms/ShutterButton';
import { LastAddedPill } from './LastAddedPill';
import { scannerScreenStyles as styles } from './scannerScreenStyles';
import type { ScannedCard } from '../types/scan';

/** Hint / last-added tray + bottom controls (total, shutter, Review). */
export function ScannerBottomBar({
  bottomPad,
  busy,
  lastAdded,
  onOpenAnalysis,
  sessionRunning,
  error,
  queueCount,
  queueTotal,
  onShutter,
  onNext,
}: {
  bottomPad: number;
  busy: boolean;
  lastAdded: ScannedCard | null;
  onOpenAnalysis: (card: ScannedCard) => void;
  sessionRunning: boolean;
  error: string | null;
  queueCount: number;
  queueTotal: number;
  onShutter: () => void;
  onNext: () => void;
}) {
  return (
    <View style={[styles.bottomOverlay, { paddingBottom: bottomPad }]} pointerEvents="box-none">
      <View style={styles.trayRow}>
        <View style={styles.trayLeft}>
          {busy ? (
            <View style={styles.hintBubble}>
              <ActivityIndicator color={colors.text} size="small" />
              <Text style={styles.hintText}> Looking for the card…</Text>
            </View>
          ) : lastAdded ? (
            <LastAddedPill card={lastAdded} onPress={onOpenAnalysis} />
          ) : (
            <View style={styles.hintBubble}>
              <Text style={styles.hintText}>
                {sessionRunning ? (
                  <>
                    Scan the <Text style={styles.hintBold}>front</Text> of the card to get started.
                  </>
                ) : (
                  'Camera starting…'
                )}
              </Text>
            </View>
          )}
        </View>
        {lastAdded && !busy ? (
          <View style={styles.modifyHint}>
            <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
            <Text style={styles.modifyHintText}>Tap for the{'\n'}price read</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBubble}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.totalText}>Total market: ${queueTotal.toFixed(2)}</Text>

      <View style={styles.shutterRow}>
        <View style={styles.shutterSide} />
        <ShutterButton onPress={onShutter} loading={busy} disabled={busy || !sessionRunning} />
        <View style={[styles.shutterSide, styles.shutterRight]}>
          <Pressable
            onPress={onNext}
            disabled={queueCount === 0}
            style={[styles.nextButton, queueCount === 0 && styles.nextButtonDisabled]}
          >
            <Text style={styles.nextText}>Review ({queueCount})</Text>
            <Ionicons name="arrow-forward" size={15} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
