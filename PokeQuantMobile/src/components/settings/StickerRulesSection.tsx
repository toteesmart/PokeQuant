// Sticker Price Rules — how suggested sticker prices round before
// landing on a card. Writes straight to the vendor store; no local
// draft state.
import { Text, View } from 'react-native';
import { CollapsibleSection } from '../CollapsibleSection';
import { Dropdown } from '../Dropdown';
import { NumericStepper } from '../NumericStepper';
import {
  useVendorStore,
  type RoundingMethod,
  ROUNDING_METHODS,
} from '../../store/vendorStore';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

export function StickerRulesSection({ expanded, onToggle }: Props) {
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const updateStickerRules = useVendorStore(
    (state) => state.updateStickerRules
  );

  return (
    <CollapsibleSection
      title="Sticker Price Rules"
      expanded={expanded}
      onToggle={onToggle}
      maxHeight={600}>
      <Text style={styles.sectionSubtitle}>
        Choose how suggested sticker prices round before they land on a
        card.
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
    </CollapsibleSection>
  );
}
