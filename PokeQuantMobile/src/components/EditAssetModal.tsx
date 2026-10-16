import { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../constants/colors';
import { useInventoryStore } from '../store/inventoryStore';
import type { InventoryCard } from '../store/inventoryStore';
import { AppButton, GlassSheet } from './ui';

const PRIMARY_TEXT = colors.text;
const PLACEHOLDER_TEXT = colors.text;

function normalizeCurrencyInput(text: string): string {
  return text.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');
}

function parsePositiveNumber(text: string): number | null {
  const v = Number.parseFloat(text);
  if (Number.isNaN(v) || v < 0) return null;
  return v;
}

type EditAssetModalProps = {
  visible: boolean;
  card: InventoryCard | null;
  onClose: () => void;
};

export function EditAssetModal({ visible, card, onClose }: EditAssetModalProps) {
  const updateInventoryCard = useInventoryStore((state) => state.updateInventoryCard);

  const [cardName, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [condition, setCondition] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stickerPrice, setStickerPrice] = useState('');

  // Sync local form state whenever the card being edited changes —
  // render-adjusted on card identity.
  const [prevCard, setPrevCard] = useState(card);
  if (card !== prevCard) {
    setPrevCard(card);
    if (card) {
      setCardName(card.name);
      setSetName(card.set ?? '');
      setCondition(card.condition ?? '');
      setPurchasePrice(String(card.amountPaid));
      setStickerPrice(String(card.stickerPrice));
    }
  }

  const handleSave = () => {
    if (!card) return;
    const price = parsePositiveNumber(purchasePrice);
    const sticker = parsePositiveNumber(stickerPrice);
    if (!cardName.trim() || price === null || sticker === null) return;

    updateInventoryCard({
      id: card.id,
      name: cardName.trim(),
      set: setName.trim() || undefined,
      condition: condition.trim() || undefined,
      amountPaid: price,
      stickerPrice: sticker,
    });

    onClose();
  };

  const imageSource = card?.imageUrl
    ? { uri: card.imageUrl }
    : require('../../store-assets/logo.png');

  if (!visible || !card) return null;

  return (
    <GlassSheet
      title="Edit card"
      onClose={onClose}
      artUri={card.imageUrl ?? null}
      keyboardAware
      scrollProps={{
        keyboardDismissMode: 'interactive',
        keyboardShouldPersistTaps: 'handled',
      }}
      footer={
        <View style={styles.footerRow}>
          <AppButton title="Cancel" variant="ghost" onPress={onClose} style={styles.footerBtn} />
          <AppButton
            title="Save changes"
            color={colors.success}
            onPress={handleSave}
            style={styles.footerBtn}
          />
        </View>
      }
    >
      <>
        {/* 1. Image Wrapper (Hardcoded Height) */}
        <View style={styles.imageWrapper}>
          <Image source={imageSource} style={styles.cardImage} resizeMode="contain" />
        </View>

        {/* 2. Form Wrapper (width: '100%') containing TextInputs */}
        <View style={styles.formWrapper}>
          <View style={styles.field}>
            <Text style={styles.label}>Card Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Eevee VMAX"
              placeholderTextColor={PLACEHOLDER_TEXT}
              value={cardName}
              onChangeText={setCardName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Set Name / Number</Text>
            <TextInput
              style={styles.input}
              placeholder='e.g. "Crown Zenith" or SWSH 114'
              placeholderTextColor={PLACEHOLDER_TEXT}
              value={setName}
              onChangeText={setSetName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Condition</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. NM"
              placeholderTextColor={PLACEHOLDER_TEXT}
              value={condition}
              onChangeText={setCondition}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.label}>What you paid ($)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={PLACEHOLDER_TEXT}
                value={purchasePrice}
                onChangeText={(text) => setPurchasePrice(normalizeCurrencyInput(text))}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Expected sticker ($)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={PLACEHOLDER_TEXT}
                value={stickerPrice}
                onChangeText={(text) => setStickerPrice(normalizeCurrencyInput(text))}
              />
            </View>
          </View>
        </View>
      </>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  footerBtn: {
    flex: 1,
  },
  imageWrapper: {
    height: 160,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardImage: {
    width: 100,
    height: 140,
  },
  formWrapper: {
    width: '100%',
  },
  field: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  label: {
    color: PRIMARY_TEXT,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.overlay3,
    color: PRIMARY_TEXT,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 14,
  },
});
