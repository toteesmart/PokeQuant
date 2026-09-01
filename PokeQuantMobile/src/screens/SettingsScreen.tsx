import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../constants/colors';
import { useVendorSettings } from '../context/VendorSettingsContext';

// The percentage values managed here are automatically imported into the
// Search & Buy screen's floating cards to calculate dynamic cash offers
// based on the live market price.

function parseRange(text: string): { min: number; max: number } | null {
  const parts = text.split('-').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const min = parseFloat(parts[0]);
  const max = parseFloat(parts[1]);
  if (
    isNaN(min) ||
    isNaN(max) ||
    min < 0 ||
    max < 0 ||
    min > max
  ) {
    return null;
  }
  return { min, max };
}

function parsePercent(text: string): number | null {
  const v = parseFloat(text.trim());
  if (isNaN(v) || v < 0 || v > 100) return null;
  return v;
}

export function SettingsScreen() {
  const { tiers, updateTier } = useVendorSettings();

  const [rangeInputs, setRangeInputs] = useState<string[]>(() =>
    tiers.map((t) => `${t.minDollar}-${t.maxDollar}`)
  );
  const [marginInputs, setMarginInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.marginPercent))
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
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
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

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            These percentage values are used by Search & Buy to calculate
            dynamic cash offers based on each card's live market price.
          </Text>
        </View>
      </ScrollView>
    </View>
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
  notice: {
    marginTop: 20,
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
});
