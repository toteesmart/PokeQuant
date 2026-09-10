import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import type { OcrResult } from '../services/ocr/TextRecognition';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';

type Props = {
  uri: string;
  confidence: number | null;
  usedGuideFallback: boolean;
  ocr?: OcrResult | null;
  match?: CatalogMatch | null;
  onRetake: () => void;
  onContinue?: () => void;
};

export function CropPreview({
  uri,
  confidence,
  usedGuideFallback,
  ocr,
  match,
  onRetake,
  onContinue,
}: Props) {
  const variant = match ? match.card.variants[0] : null;

  return (
    <View style={styles.container}>
      <Image source={{ uri }} style={styles.croppedImage} contentFit="contain" cachePolicy="none" />
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
            {variant ? (
              <Text style={styles.matchPrice}>
                ${variant.marketPrice.toFixed(2)} — {variant.subType}
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.noMatch}>
          <Text style={styles.noMatchText}>No catalog match yet</Text>
        </View>
      )}

      <View style={styles.ocrSection}>
        {ocr?.topText ? (
          <View style={styles.ocrBadge}>
            <Text style={styles.ocrLabel}>Top</Text>
            <Text style={styles.ocrText} numberOfLines={2}>
              {ocr.topText}
            </Text>
          </View>
        ) : null}

        {ocr?.bottomText ? (
          <View style={styles.ocrBadge}>
            <Text style={styles.ocrLabel}>Bottom</Text>
            <Text style={styles.ocrText} numberOfLines={2}>
              {ocr.bottomText}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        {onContinue ? (
          <Pressable onPress={onContinue} style={[styles.button, styles.primaryButton]}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onRetake} style={styles.button}>
          <Text style={styles.buttonText}>Retake</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  croppedImage: {
    flex: 1,
    width: '100%',
    minHeight: 120,
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
    marginHorizontal: 16,
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
  matchPrice: {
    color: colors.success ?? '#4caf50',
    fontSize: 14,
    fontWeight: 'bold',
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
  ocrSection: {
    width: '100%',
    marginTop: 12,
  },
  ocrBadge: {
    marginTop: 8,
    marginHorizontal: 16,
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
    marginBottom: 24,
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
