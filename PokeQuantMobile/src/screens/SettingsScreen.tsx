import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { NumericStepper } from '../components/NumericStepper';
import {
  useVendorSettings,
  type RoundingMethod,
  ROUNDING_METHODS,
} from '../context/VendorSettingsContext';

// The percentage values managed here are automatically imported into the
// Search & Buy screen's floating cards to calculate dynamic cash offers
// based on the live market price.

function parseRange(text: string): { min: number; max: number } | null {
  const parts = text.split('-').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const min = Number.parseFloat(parts[0]);
  const max = Number.parseFloat(parts[1]);
  if (
    Number.isNaN(min) ||
    Number.isNaN(max) ||
    min < 0 ||
    max < 0 ||
    min > max
  ) {
    return null;
  }
  return { min, max };
}

function parsePercent(text: string): number | null {
  const v = Number.parseFloat(text.trim());
  if (Number.isNaN(v) || v < 0 || v > 100) return null;
  return v;
}

export function SettingsScreen() {
  const {
    tiers,
    updateTier,
    stickerRules,
    updateStickerRules,
    launchTour,
    isTourActive,
  } = useVendorSettings();

  const [rangeInputs, setRangeInputs] = useState<string[]>(() =>
    tiers.map((t) => `${t.minDollar}-${t.maxDollar}`)
  );
  const [marginInputs, setMarginInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.marginPercent))
  );

  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      if (isTourActive) {
        const t = setTimeout(() => {
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }, 250);
        return () => clearTimeout(t);
      }
    }, [isTourActive])
  );

  const handleRangeChange = (index: number, text: string) => {
    setRangeInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });

    const parsed = parseRange(text);
    if (parsed) {
      updateTier(index, { minDollar: parsed.min, maxDollar: parsed.max });
    }
  };

  const handleMarginChange = (index: number, text: string) => {
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });

    const parsed = parsePercent(text);
    if (parsed !== null) {
      updateTier(index, { marginPercent: parsed });
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Vendor Settings</Text>
        <Text style={styles.subtitle}>
          Buy tiers define the cash offers shown on Search & Buy cards.
        </Text>

        <View style={styles.tiers}>
          {tiers.map((tier, index) => (
            <View key={index} style={styles.tierCard}>
              <Text style={styles.tierHeading}>Tier {index + 1}</Text>
              <View style={styles.tierRow}>
                <View style={styles.tierCol}>
                  <Text style={styles.tierLabel}>Price Range ($)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      !parseRange(rangeInputs[index] ?? '') &&
                        styles.inputInvalid,
                    ]}
                    placeholder="2-20"
                    placeholderTextColor={colors.textMuted}
                    value={rangeInputs[index]}
                    onChangeText={(text) => handleRangeChange(index, text)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.tierCol}>
                  <Text style={styles.tierLabel}>Margin (%)</Text>
                  <TextInput
                    style={[
                      styles.input,
                      parsePercent(marginInputs[index] ?? '') === null &&
                        styles.inputInvalid,
                    ]}
                    placeholder="43"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    value={marginInputs[index]}
                    onChangeText={(text) => handleMarginChange(index, text)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Sticker Price Rules</Text>
          <Text style={styles.sectionSubtitle}>
            Configure how projected sticker prices are rounded and floored
            before they hit your inventory.
          </Text>

          <View style={styles.ruleRow}>
            <View style={styles.ruleFull}>
              <Dropdown
                label="Rounding Method"
                options={ROUNDING_METHODS}
                value={stickerRules.roundingMethod}
                onChange={(v) =>
                  updateStickerRules({ roundingMethod: v as RoundingMethod })
                }
              />
            </View>
          </View>

          <View style={styles.ruleRow}>
            <View style={styles.ruleHalf}>
              <NumericStepper
                label="Floor/Ceil Cutoff Threshold"
                value={stickerRules.cutoff}
                step={0.05}
                min={0}
                max={1}
                decimalPlaces={2}
                onChange={(v) => updateStickerRules({ cutoff: v })}
              />
            </View>
            <View style={styles.ruleHalf}>
              <NumericStepper
                label="Minimum Sticker Price ($)"
                value={stickerRules.minSticker}
                step={0.5}
                min={0}
                decimalPlaces={2}
                onChange={(v) => updateStickerRules({ minSticker: v })}
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Onboarding</Text>
          <Text style={styles.sectionSubtitle}>
            New to PokeQuant? Relaunch the vendor tour at any time.
          </Text>
          <Pressable
            onPress={launchTour}
            style={({ pressed }) => [
              styles.relaunchButton,
              pressed && styles.relaunchButtonPressed,
            ]}>
            <Text style={styles.relaunchButtonText}>Relaunch Tour</Text>
          </Pressable>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            These percentage values are used by Search & Buy to calculate
            dynamic cash offers based on each card's live market price.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 20,
  },
  tiers: {
    gap: 12,
  },
  tierCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tierHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  tierRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
  },
  tierCol: {
    flex: 1,
    paddingHorizontal: 6,
  },
  tierLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputInvalid: {
    borderColor: colors.error,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
  },
  ruleFull: {
    flex: 1,
    paddingHorizontal: 6,
  },
  ruleHalf: {
    flex: 1,
    paddingHorizontal: 6,
  },
  notice: {
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  relaunchButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  relaunchButtonPressed: {
    opacity: 0.8,
  },
  relaunchButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
