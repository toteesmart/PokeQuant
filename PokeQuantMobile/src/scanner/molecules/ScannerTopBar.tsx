import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { scannerScreenStyles as styles } from './scannerScreenStyles';

export function ScannerTopBar({
  topPad,
  showBack,
  onClose,
  showMeter,
  trialDaysLeft,
  scansLeft,
  showTrade,
  onTrade,
  onToggleDebug,
}: {
  topPad: number;
  showBack: boolean;
  onClose?: () => void;
  showMeter: boolean;
  trialDaysLeft: number;
  scansLeft: number;
  showTrade: boolean;
  onTrade: () => void;
  onToggleDebug: () => void;
}) {
  return (
        <View style={[styles.topBar, { paddingTop: topPad }]}>
          {showBack ? (
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.topIcon}
              accessibilityLabel="Close scanner"
              accessibilityRole="button">
              <Ionicons name="chevron-back" size={26} color={colors.onAccent}/>
            </Pressable>
          ) : (
            <View style={styles.topIcon} />
          )}
          {/* Scan meter pill — free users see the trial countdown first, then
              the daily count. Entitled/vendor users get an empty spacer. */}
          {showMeter ? (
            <View style={styles.meterPill} pointerEvents="none">
              <Ionicons name="scan-outline" size={13} color={colors.textMuted} />
              <Text style={styles.meterPillText}>
                {trialDaysLeft > 0
                  ? `Free unlimited: ${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
                  : `${scansLeft} free scan${scansLeft === 1 ? '' : 's'} left today`}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <View style={styles.topRightIcons}>
            {showTrade ? (
              <Pressable
                onPress={onTrade}
                hitSlop={12}
                style={styles.topIcon}
                accessibilityLabel="Check a trade"
                accessibilityRole="button"
              >
                <Ionicons name="swap-horizontal" size={22} color={colors.onAccent}/>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onToggleDebug}
              hitSlop={12}
              style={styles.topIcon}
              accessibilityLabel="Toggle scan diagnostics"
              accessibilityRole="button"
            >
              <Ionicons name="settings-outline" size={22} color={colors.onAccent}/>
            </Pressable>
          </View>
        </View>
  );
}
