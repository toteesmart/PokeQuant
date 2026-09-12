import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import type { OcrResult } from '../services/ocr/TextRecognition';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import type { VisualMatch } from '../services/visual/visualMatcher';
import type { ConditionCode } from '../types/scan';

type Props = {
  uri: string;
  confidence: number | null;
  usedGuideFallback: boolean;
  ocr?: OcrResult | null;
  match?: CatalogMatch | null;
  visualMatches?: VisualMatch[];
  onRetake: () => void;
  onConfirm?: (condition: ConditionCode, quantity: number) => void;
  onSelectMatch?: (match: CatalogMatch) => void;
};

export function CropPreview({
  uri,
  confidence,
  usedGuideFallback,
  ocr,
  match,
  visualMatches,
  onRetake,
  onConfirm,
  onSelectMatch,
}: Props) {
  const condition: ConditionCode = 'NM';
  const [quantity, setQuantity] = useState(1);
  const [ocrExpanded, setOcrExpanded] = useState(false);

  const variant = match?.card.variants[0];
  const multiplier = CONDITION_MULTIPLIERS[condition];
  const unitPrice = variant ? Number((variant.marketPrice * multiplier).toFixed(2)) : 0;
  const totalPrice = Number((unitPrice * quantity).toFixed(2));

  const handleConfirm = () => {
    if (match && onConfirm) {
      onConfirm(condition, quantity);
    }
  };

  const handleSelectVisual = (visual: VisualMatch) => {
    if (!onSelectMatch) return;
    onSelectMatch({
      card: visual.card,
      method: 'visual',
      confidence: Math.max(0, Math.min(1, visual.score)),
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View style={styles.sideControl}>
            <Pressable onPress={onRetake} style={[styles.sideButton, styles.retakeButton]}>
              <Text style={styles.sideButtonText}>Retake</Text>
            </Pressable>
          </View>

          <View style={styles.cropContainer}>
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
          </View>

          <View style={styles.sideControl}>
            {match ? (
              <Pressable
                onPress={handleConfirm}
                style={[styles.sideButton, styles.confirmButton]}
              >
                <Text style={styles.sideButtonText}>Confirm</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {ocr?.numberText ? (
          <View style={styles.numberRow}>
            <View style={styles.quantityControl}>
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

            <View style={styles.numberBadge}>
              <Text style={styles.numberText}>#{ocr.numberText}</Text>
            </View>

            <Text style={styles.pricePreview}>${totalPrice}</Text>
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

        {visualMatches && visualMatches.length > 0 ? (
          <View style={styles.visualSection}>
            <Text style={styles.sectionLabel}>Visual matches (tap to select)</Text>
            {visualMatches.map((m, i) => {
              const isSelected = m.card.productId === match?.card.productId;
              return (
                <Pressable
                  key={m.card.productId}
                  onPress={() => handleSelectVisual(m)}
                  style={[
                    styles.visualMatchRow,
                    isSelected && styles.visualMatchRowActive,
                    i === 0 && styles.visualMatchRowTop,
                  ]}
                >
                  {m.card.imageUrl ? (
                    <Image
                      source={{ uri: m.card.imageUrl }}
                      style={styles.visualMatchImage}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : null}
                  <View style={styles.visualMatchInfo}>
                    <Text style={styles.visualMatchName}>{m.card.name}</Text>
                    <Text style={styles.visualMatchScore}>
                      {(m.score * 100).toFixed(1)}% similar
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {ocr ? (
          <View style={styles.ocrSection}>
            <Pressable
              onPress={() => setOcrExpanded((v) => !v)}
              style={styles.ocrHeader}
            >
              <Text style={styles.ocrHeaderText}>OCR debug</Text>
              <Text style={styles.ocrToggle}>{ocrExpanded ? '−' : '+'}</Text>
            </Pressable>
            {ocrExpanded ? (
              <View style={styles.ocrBody}>
                {ocr.topText ? (
                  <View style={styles.ocrBadge}>
                    <Text style={styles.ocrLabel}>Top</Text>
                    <Text style={styles.ocrText} numberOfLines={3}>
                      {ocr.topText}
                    </Text>
                  </View>
                ) : null}
                {ocr.bottomText ? (
                  <View style={styles.ocrBadge}>
                    <Text style={styles.ocrLabel}>Bottom</Text>
                    <Text style={styles.ocrText} numberOfLines={3}>
                      {ocr.bottomText}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 12,
  },
  sideControl: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  retakeButton: {
    backgroundColor: colors.surface,
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  sideButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  cropContainer: {
    alignItems: 'center',
  },
  croppedImage: {
    width: 180,
    height: 250,
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
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 16,
    width: '100%',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  quantityValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    minWidth: 28,
    textAlign: 'center',
  },
  numberBadge: {
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
  pricePreview: {
    color: colors.success,
    fontSize: 14,
    fontWeight: 'bold',
    minWidth: 60,
    textAlign: 'right',
  },
  matchCard: {
    marginTop: 16,
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
  visualSection: {
    width: '100%',
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  visualMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 8,
  },
  visualMatchRowTop: {
    marginTop: 0,
  },
  visualMatchRowActive: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  visualMatchImage: {
    width: 50,
    height: 70,
    borderRadius: 6,
  },
  visualMatchInfo: {
    flex: 1,
    marginLeft: 12,
  },
  visualMatchName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  visualMatchScore: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  ocrSection: {
    width: '100%',
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  ocrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  ocrHeaderText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: 'bold',
  },
  ocrToggle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  ocrBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  ocrBadge: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
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
});
