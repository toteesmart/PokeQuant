// Buy Tiers — editable offer bands that set the prices on Search & Buy
// cards. Local string inputs mirror the store so typing never fights
// formatting; a blur commits the sanitized value. skipSyncRef guards
// the store→inputs sync so this screen's own writes don't clobber
// in-flight edits.
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Slider } from '@miblanchard/react-native-slider';
import { colors } from '../../constants/colors';
import { CollapsibleSection } from '../CollapsibleSection';
import {
  useVendorStore,
  DEFAULT_TIERS,
} from '../../store/vendorStore';
import {
  clampPercent,
  isDollarTextValid,
  isPercentTextValid,
  parseDollar,
  parsePercent,
  sanitizeMinMax,
} from '../../utils/numberInput';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
  scrollRef: RefObject<ScrollView | null>;
};

export function BuyTiersSection({ expanded, onToggle, scrollRef }: Props) {
  const tiers = useVendorStore((state) => state.tiers);
  const setTiers = useVendorStore((state) => state.setTiers);
  const updateTier = useVendorStore((state) => state.updateTier);

  const [minInputs, setMinInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.minDollar))
  );
  const [maxInputs, setMaxInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.maxDollar))
  );
  const [marginInputs, setMarginInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.marginPercent))
  );

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

  return (
    <CollapsibleSection
      title="Buy Tiers"
      expanded={expanded}
      onToggle={onToggle}
      maxHeight={1600}>
      <Text style={styles.sectionSubtitle}>
        Buy tiers set the offer prices shown on Search & Buy cards.
      </Text>
      <View style={styles.tiers}>
        {tiers.map((tier, index) => {
          const marginText =
            marginInputs[index] ?? String(tier.marginPercent);
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
                      tiers.length === 1 &&
                        styles.removeButtonTextDisabled,
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
                    onChangeText={(text) =>
                      handleMarginChange(index, text)
                    }
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
    </CollapsibleSection>
  );
}
