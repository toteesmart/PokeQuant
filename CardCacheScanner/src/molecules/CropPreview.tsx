import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import type { OcrResult } from '../services/ocr/TextRecognition';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import type { ConditionCode } from '../types/scan';

type Props = {
  uri: string;
  confidence: number | null;
  usedGuideFallback: boolean;
  ocr?: OcrResult | null;
  match?: CatalogMatch | null;
  onRetake: () => void;
  onConfirm?: (condition: ConditionCode, quantity: number) => void;
};

export function CropPreview({
  uri,
  confidence,
  usedGuideFallback,
  ocr,
  match,
  onRetake,
  onConfirm,
}: Props) {
  const [condition, setCondition] = useState<ConditionCode>('NM');
  const [quantity, setQuantity] = useState(1);

  const variant = match?.card.variants[0];
  const multiplier = CONDITION_MULTIPLIERS[condition];
  const unitPrice = variant ? Number((variant.marketPrice * multiplier).toFixed(2)) : 0;
  const totalPrice = Number((unitPrice * quantity).toFixed(2));

  const handleConfirm = () => {
    if (match && onConfirm) {
      onConfirm(condition, quantity);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={{ uri }}
          style={styles.croppedImage}
          contentFit="contain"
          cachePolicy="none"
        />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {usedGuideFallback
              ? 'Guide crop (no card detected)'
              : `Card crop ${(confidence ?? 0).toFixed(2)}`}
          </Text>
        </View>

        {ocr?.numberText ? (
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>#{ocr.numberText}</Text>
          </View>
        ) : null}

        {match ? (
          <View style={styles.matchCard}>
            {match.card.imageUrl ? (
              <Image
                source={{ uri: match.card.imageUrl }}
                style={styles.matchImage}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : null}
            <View style={styles.matchInfo}>
              <Text style={styles.matchName}>{match.card.name}</Text>
              <Text style={styles.matchSet}>{match.card.set}</Text>
              <Text style={styles.matchNumber}>{match.card.number}</Text>
              <Text style={styles.matchMethod}>
                Matched by {match.method} ({(match.confidence * 100).toFixed(0)}%)
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.noMatch}>
            <Text style={styles.noMatchText}>No catalog match yet</Text>
          </View>
        )}

        {match ? (
          <View style={styles.confirmation}>
            <Text style={styles.sectionLabel}>Condition</Text>
            <View style={styles.conditionRow}>
              {CONDITION_CODES.map((code) => (
                <Pressable
                  key={code}
                  onPress={() => setCondition(code)}
                  style={[
                    styles.conditionChip,
                    condition === code && styles.conditionChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.conditionCode,
                      condition === code && styles.conditionCodeActive,
                    ]}
                  >
                    {code}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.conditionLabel}>{CONDITION_LABELS[condition]}</Text>

            <Text style={styles.sectionLabel}>Quantity</Text>
            <View style={styles.quantityRow}>
              <Pressable
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                style={styles.quantityButton}
              >
                <Text style={styles.quantityButtonText}>-</Text>
              </Pressable>
              <Text style={styles.quantityValue}>{quantity}</Text>
              <Pressable
                onPress={() => setQuantity((q) => q + 1)}
                style={styles.quantityButton}
              >
                <Text style={styles.quantityButtonText}>+</Text>
              </Pressable>
            </View>

            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Price preview</Text>
              <Text style={styles.priceValue}>
                ${totalPrice} <Text style={styles.priceUnit}>({quantity} × ${unitPrice})</Text>
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.ocrSection}>
          {ocr?.topText ? (
            <View style={styles.ocrBadge}>
              <Text style={styles.ocrLabel}>Top OCR</Text>
              <Text style={styles.ocrText} numberOfLines={2}>
                {ocr.topText}
              </Text>
            </View>
          ) : null}

          {ocr?.bottomText ? (
            <View style={styles.ocrBadge}>
              <Text style={styles.ocrLabel}>Bottom OCR</Text>
              <Text style={styles.ocrText} numberOfLines={2}>
                {ocr.bottomText}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.controls}>
          {match ? (
            <Pressable onPress={handleConfirm} style={[styles.button, styles.primaryButton]}>
              <Text style={styles.primaryButtonText}>Confirm</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onRetake} style={styles.button}>
            <Text style={styles.buttonText}>Retake</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const CONDITION_MULTIPLIERS: Record<ConditionCode, number> = {
  NM: 1.0,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: 16,
    paddingBottom: 32,
  },
  croppedImage: {
    width: '100%',
    height: 220,
    borderRadius: 8,
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  badgeText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  numberBadge: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  numberText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  matchCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  matchImage: {
    width: 80,
    height: 110,
    borderRadius: 8,
  },
  matchInfo: {
    flex: 1,
    marginLeft: 12,
  },
  matchName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  matchSet: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  matchNumber: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 2,
  },
  matchMethod: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  noMatch: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  noMatchText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  confirmation: {
    width: '100%',
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conditionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  conditionChipActive: {
    backgroundColor: colors.primary,
  },
  conditionCode: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  conditionCodeActive: {
    color: '#fff',
  },
  conditionLabel: {
    color: colors.text,
    fontSize: 14,
    marginTop: 8,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  quantityButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  quantityValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    minWidth: 40,
    textAlign: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  priceValue: {
    color: colors.success,
    fontSize: 18,
    fontWeight: 'bold',
  },
  priceUnit: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: 'normal',
  },
  ocrSection: {
    width: '100%',
    marginTop: 16,
  },
  ocrBadge: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ocrLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: 4,
  },
  ocrText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  controls: {
    marginTop: 16,
    gap: 12,
    alignItems: 'center',
  },
  button: {
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: '#fff',
  },
});
