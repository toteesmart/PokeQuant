import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Slider } from '@miblanchard/react-native-slider';

import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { NumericStepper } from '../components/NumericStepper';
import { BulkImportWizard } from '../components/BulkImportWizard';
import {
  useVendorStore,
  DEFAULT_TIERS,
  type RoundingMethod,
  ROUNDING_METHODS,
} from '../store/vendorStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useAuth } from '../context/AuthContext';

const DOLLAR_INPUT_RE = /^\d*\.?\d*$/;
const PERCENT_INPUT_RE = /^\d*\.?\d*$/;

function parseDollar(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0) return null;
  return Number(v.toFixed(2));
}

function parsePercent(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0 || v > 100) return null;
  return v;
}

function sanitizeMinMax(
  min: number,
  max: number,
  changed: 'min' | 'max'
): { min: number; max: number } {
  const round2 = (n: number) => Number(n.toFixed(2));
  min = Math.max(0, round2(min));
  max = Math.max(0, round2(max));

  if (min >= max) {
    if (changed === 'min') {
      max = round2(min + 0.01);
    } else {
      min = round2(max - 0.01);
      if (min < 0) {
        min = 0;
        max = 0.01;
      }
    }
  }

  return { min, max };
}

function isDollarTextValid(text: string): boolean {
  if (text === '') return true;
  if (!DOLLAR_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0;
}

function isPercentTextValid(text: string): boolean {
  if (text === '') return true;
  if (!PERCENT_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0 && v <= 100;
}

function clampPercent(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function SettingsScreen() {
  const tiers = useVendorStore((state) => state.tiers);
  const setTiers = useVendorStore((state) => state.setTiers);
  const updateTier = useVendorStore((state) => state.updateTier);
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const updateStickerRules = useVendorStore(
    (state) => state.updateStickerRules
  );

  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const deleteAccount = useInventoryStore((state) => state.deleteAccount);
  const { logout } = useAuth();

  const [minInputs, setMinInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.minDollar))
  );
  const [maxInputs, setMaxInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.maxDollar))
  );
  const [marginInputs, setMarginInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.marginPercent))
  );
  const [importVisible, setImportVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const skipSyncRef = useRef(false);

  // Sync local input state with external store changes (e.g. remote load)
  // without clobbering edits made from this screen.
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setMinInputs(tiers.map((t) => String(t.minDollar)));
    setMaxInputs(tiers.map((t) => String(t.maxDollar)));
    setMarginInputs(tiers.map((t) => String(t.marginPercent)));
  }, [tiers]);

  const handleMinChange = (index: number, text: string) => {
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMaxChange = (index: number, text: string) => {
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMinBlur = (index: number) => {
    const raw = minInputs[index] ?? '';
    const parsed = parseDollar(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMinInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.minDollar);
        return next;
      });
      return;
    }

    const { min, max } = sanitizeMinMax(parsed, current.maxDollar, 'min');

    skipSyncRef.current = true;
    updateTier(index, { minDollar: min, maxDollar: max });
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = String(min);
      return next;
    });
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = String(max);
      return next;
    });
  };

  const handleMaxBlur = (index: number) => {
    const raw = maxInputs[index] ?? '';
    const parsed = parseDollar(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMaxInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.maxDollar);
        return next;
      });
      return;
    }

    const { min, max } = sanitizeMinMax(current.minDollar, parsed, 'max');

    skipSyncRef.current = true;
    updateTier(index, { minDollar: min, maxDollar: max });
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = String(min);
      return next;
    });
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = String(max);
      return next;
    });
  };

  const handleMarginChange = (index: number, text: string) => {
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMarginBlur = (index: number) => {
    const raw = marginInputs[index] ?? '';
    const parsed = parsePercent(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMarginInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.marginPercent);
        return next;
      });
      return;
    }

    const clamped = clampPercent(parsed);

    skipSyncRef.current = true;
    updateTier(index, { marginPercent: clamped });
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleMarginSliderChange = (index: number, value: number) => {
    const clamped = clampPercent(value);
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleMarginSliderComplete = (index: number, value: number) => {
    const clamped = clampPercent(value);
    const current = tiers[index];

    if (clamped !== current.marginPercent) {
      skipSyncRef.current = true;
      updateTier(index, { marginPercent: clamped });
    }

    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleAddTier = () => {
    const last = tiers[tiers.length - 1];
    const newMin = last ? Number(last.maxDollar.toFixed(2)) : 0;
    const newMax = last ? Number((last.maxDollar + 10).toFixed(2)) : 10;
    const newMargin = last ? last.marginPercent : 50;
    const newTier = {
      minDollar: newMin,
      maxDollar: newMax,
      marginPercent: newMargin,
    };

    skipSyncRef.current = true;
    setTiers([...tiers, newTier]);
    setMinInputs((prev) => [...prev, String(newTier.minDollar)]);
    setMaxInputs((prev) => [...prev, String(newTier.maxDollar)]);
    setMarginInputs((prev) => [...prev, String(newTier.marginPercent)]);

    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
  };

  const handleRemoveTier = (index: number) => {
    if (tiers.length <= 1) return;

    skipSyncRef.current = true;
    setTiers(tiers.filter((_, i) => i !== index));
    setMinInputs((prev) => prev.filter((_, i) => i !== index));
    setMaxInputs((prev) => prev.filter((_, i) => i !== index));
    setMarginInputs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetTiers = () => {
    const next = DEFAULT_TIERS.map((t) => ({ ...t }));

    skipSyncRef.current = true;
    setTiers(next);
    setMinInputs(next.map((t) => String(t.minDollar)));
    setMaxInputs(next.map((t) => String(t.maxDollar)));
    setMarginInputs(next.map((t) => String(t.marginPercent)));
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete All Account Info',
      'This will permanently erase your cloud inventory, settings, and local database. This action cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteAccount();
              logout();
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Delete failed';
              Alert.alert('Delete failed', message);
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
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
          {tiers.map((tier, index) => {
            const marginText = marginInputs[index] ?? String(tier.marginPercent);
            const sliderValue = Number.isNaN(Number(marginText))
              ? tier.marginPercent
              : Number(marginText);

            return (
              <View key={`tier-${index}`} style={styles.tierCard}>
                <View style={styles.tierHeader}>
                  <Text style={styles.tierHeading}>Tier {index + 1}</Text>
                  <TouchableOpacity
                    style={[
                      styles.removeButton,
                      tiers.length === 1 && styles.removeButtonDisabled,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => handleRemoveTier(index)}
                    disabled={tiers.length === 1}>
                    <Text
                      style={[
                        styles.removeButtonText,
                        tiers.length === 1 && styles.removeButtonTextDisabled,
                      ]}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.tierRow}>
                  <View style={styles.tierCol}>
                    <Text style={styles.tierLabel}>Min ($)</Text>
                    <TextInput
                      style={[
                        styles.input,
                        !isDollarTextValid(minInputs[index] ?? '') &&
                          styles.inputInvalid,
                      ]}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      value={minInputs[index]}
                      onChangeText={(text) => handleMinChange(index, text)}
                      onBlur={() => handleMinBlur(index)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.tierCol}>
                    <Text style={styles.tierLabel}>Max ($)</Text>
                    <TextInput
                      style={[
                        styles.input,
                        !isDollarTextValid(maxInputs[index] ?? '') &&
                          styles.inputInvalid,
                      ]}
                      placeholder="10"
                      placeholderTextColor={colors.textMuted}
                      value={maxInputs[index]}
                      onChangeText={(text) => handleMaxChange(index, text)}
                      onBlur={() => handleMaxBlur(index)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.marginControl}>
                  <Text style={styles.tierLabel}>Margin (%)</Text>
                  <View style={styles.sliderRow}>
                    <Slider
                      containerStyle={styles.slider}
                      value={sliderValue}
                      minimumValue={1}
                      maximumValue={100}
                      step={1}
                      minimumTrackTintColor={colors.primary}
                      maximumTrackTintColor={colors.border}
                      thumbTintColor={colors.primary}
                      onValueChange={(value) =>
                        handleMarginSliderChange(index, value[0])
                      }
                      onSlidingComplete={(value) =>
                        handleMarginSliderComplete(index, value[0])
                      }
                    />
                    <TextInput
                      style={[
                        styles.marginInput,
                        !isPercentTextValid(marginText) &&
                          styles.inputInvalid,
                      ]}
                      placeholder="50"
                      placeholderTextColor={colors.textMuted}
                      value={marginText}
                      onChangeText={(text) => handleMarginChange(index, text)}
                      onBlur={() => handleMarginBlur(index)}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              </View>
            );
          })}

          <View style={styles.tierActions}>
            <TouchableOpacity
              style={styles.addButton}
              activeOpacity={0.8}
              onPress={handleAddTier}>
              <Text style={styles.addButtonText}>Add Tier</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resetButton}
              activeOpacity={0.8}
              onPress={handleResetTiers}>
              <Text style={styles.resetButtonText}>Reset to Defaults</Text>
            </TouchableOpacity>
          </View>
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
          <Text style={styles.sectionTitle}>Bulk Import</Text>
          <Text style={styles.sectionSubtitle}>
            Import a CSV or Excel file and verify each row against the catalog
            before committing to inventory.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.8}
            onPress={() => setImportVisible(true)}>
            <Text style={styles.primaryButtonText}>Open Import Wizard</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.devCard}>
          <Text style={styles.devTitle}>Danger Zone</Text>
          <Text style={styles.devSubtitle}>
            Permanently delete all account data from the cloud and this device.
          </Text>
          <TouchableOpacity
            style={[
              styles.dangerButton,
              (isSyncing || isDeleting) && styles.dangerButtonDisabled,
            ]}
            activeOpacity={0.7}
            onPress={handleDeleteAccount}
            disabled={isSyncing || isDeleting}>
            {isDeleting ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.dangerButtonText}>
                Delete All Account Info
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            These percentage values are used by Search & Buy to calculate
            dynamic cash offers based on each card's live market price.
          </Text>
        </View>
      </ScrollView>

      <BulkImportWizard
        visible={importVisible}
        onClose={() => setImportVisible(false)}
      />
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
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tierHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  removeButtonText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  removeButtonTextDisabled: {
    color: colors.textMuted,
  },
  tierRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
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
  marginControl: {
    marginTop: 4,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    marginRight: 12,
    height: 40,
  },
  marginInput: {
    width: 64,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  tierActions: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginTop: 8,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  addButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButton: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  devCard: {
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  devTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  devSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  dangerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerButtonDisabled: {
    opacity: 0.5,
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
