import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Pressable } from 'react-native';
import { colors } from '../constants/colors';

type Props = {
  uri: string;
  confidence: number | null;
  usedGuideFallback: boolean;
  ocrText?: string | null;
  onRetake: () => void;
  onContinue?: () => void;
};

export function CropPreview({
  uri,
  confidence,
  usedGuideFallback,
  ocrText,
  onRetake,
  onContinue,
}: Props) {
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
      {ocrText ? (
        <View style={styles.ocrBadge}>
          <Text style={styles.ocrText} numberOfLines={6}>
            {ocrText}
          </Text>
        </View>
      ) : null}
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
  },
  badge: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  badgeText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  ocrBadge: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    maxWidth: '100%',
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
