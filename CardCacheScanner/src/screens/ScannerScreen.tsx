import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { useCameraSetup } from '../services/camera/useCameraSetup';
import { CameraPreview } from '../atoms/CameraPreview';
import { ShutterButton } from '../atoms/ShutterButton';
import { MatchReviewSheet } from '../molecules/MatchReviewSheet';
import { processPhoto, type VariantOption } from '../services/scanner/processPhoto';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import { createScannedCard, type ConditionCode, type ScannedCard } from '../types/scan';
import { useScanQueueStore } from '../store/scanQueueStore';

const DEFAULT_AUTO_CONFIRM_CONDITION: ConditionCode = 'NM';
const DEFAULT_AUTO_CONFIRM_QUANTITY = 1;

type DebugInfo = {
  cropConfidence: number | null;
  usedGuideFallback: boolean;
  topText: string;
  bottomText: string;
  numberText: string | null;
  method: string | null;
  confidence: number | null;
  autoConfirm: boolean;
};

type Props = {
  onBack?: () => void;
  onNext?: () => void;
};

export function ScannerScreen({ onBack, onNext }: Props) {
  const insets = useSafeAreaInsets();
  const camera = useCameraSetup();
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [match, setMatch] = useState<CatalogMatch | null>(null);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [otherMatches, setOtherMatches] = useState<CatalogMatch[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<ScannedCard | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const queueCount = useScanQueueStore((s) =>
    s.items.reduce((n, i) => n + i.quantity, 0)
  );
  const queueTotal = useScanQueueStore((s) =>
    s.items.reduce((n, i) => n + i.totalPrice, 0)
  );

  const reviewing = cropUri !== null;
  const busy = isCapturing || isCropping;

  const handleResetScan = useCallback(() => {
    setCropUri(null);
    setMatch(null);
    setVariantOptions([]);
    setOtherMatches([]);
    setError(null);
  }, []);

  const handleSelectMatch = useCallback((selected: CatalogMatch) => {
    console.log(
      'ScannerScreen: selected match',
      selected.card.name,
      selected.confidence.toFixed(3)
    );
    setMatch(selected);
  }, []);

  const handleConfirm = useCallback(
    (condition: ConditionCode, quantity: number) => {
      if (!match?.card) return;
      const item = createScannedCard(match.card, condition, quantity);
      useScanQueueStore.getState().add(item);
      setLastAdded(item);
      handleResetScan();
    },
    [match, handleResetScan]
  );

  const handleShutter = useCallback(async () => {
    if (!camera.ready || isCapturing || isCropping) return;
    setIsCapturing(true);
    setError(null);

    try {
      console.log('ScannerScreen: capture start');
      const photo = await camera.takePhoto();
      console.log('ScannerScreen: capture done', photo.width, photo.height);
      setIsCapturing(false);
      setIsCropping(true);

      console.log('ScannerScreen: process start');
      const crop = await processPhoto(photo);
      console.log('ScannerScreen: process done', crop.uri);

      setDebugInfo({
        cropConfidence: crop.detection?.confidence ?? null,
        usedGuideFallback: crop.usedGuideFallback,
        topText: crop.ocr?.topText ?? '',
        bottomText: crop.ocr?.bottomText ?? '',
        numberText: crop.ocr?.numberText ?? null,
        method: crop.match?.method ?? null,
        confidence: crop.fusion.top?.confidence ?? null,
        autoConfirm: crop.fusion.autoConfirm,
      });
      setCropUri(crop.uri);
      setMatch(crop.match);
      setVariantOptions(crop.variantOptions);
      setOtherMatches(crop.otherMatches);
      console.log(
        'ScannerScreen: state set',
        'autoConfirm',
        crop.fusion.autoConfirm
      );

      if (crop.fusion.autoConfirm && crop.fusion.top?.card) {
        const item = createScannedCard(
          crop.fusion.top.card,
          DEFAULT_AUTO_CONFIRM_CONDITION,
          DEFAULT_AUTO_CONFIRM_QUANTITY
        );
        useScanQueueStore.getState().add(item);
        setLastAdded(item);
        handleResetScan();
      }
    } catch (e) {
      console.error('ScannerScreen: error', e);
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera, isCapturing, isCropping, handleResetScan]);

  if (!camera.hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.text}>Camera permission is required.</Text>
        <Pressable onPress={camera.requestPermission} style={styles.button}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
      </View>
    );
  }

  if (!camera.ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.text}>Initializing camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraPreview
        device={camera.device}
        photoOutput={camera.photoOutput}
        isActive
      />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.topIcon}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.topTitle}>Pokémon</Text>
        <Pressable
          onPress={() => setDebugOpen((v) => !v)}
          hitSlop={12}
          style={styles.topIcon}
        >
          <Ionicons name="settings-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Hint / last-added tray + bottom controls */}
      {!reviewing ? (
        <View
          style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 4 }]}
          pointerEvents="box-none"
        >
          <View style={styles.trayRow}>
            <View style={styles.trayLeft}>
              {busy ? (
                <View style={styles.hintBubble}>
                  <ActivityIndicator color={colors.text} size="small" />
                  <Text style={styles.hintText}> Detecting card…</Text>
                </View>
              ) : lastAdded ? (
                <Pressable style={styles.lastPill} onPress={onNext}>
                  {lastAdded.imageUrl ? (
                    <Image
                      source={{ uri: lastAdded.imageUrl }}
                      style={styles.lastThumb}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  ) : null}
                  <View style={styles.lastInfo}>
                    <Text style={styles.lastName} numberOfLines={1}>
                      {lastAdded.name}
                    </Text>
                    <Text style={styles.lastMeta} numberOfLines={1}>
                      {lastAdded.number}
                    </Text>
                    <Text style={styles.lastPrice}>
                      ${lastAdded.totalPrice.toFixed(2)}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <View style={styles.hintBubble}>
                  <Text style={styles.hintText}>
                    Scan the <Text style={styles.hintBold}>front</Text> of the
                    card to get started.
                  </Text>
                </View>
              )}
            </View>
            {lastAdded && !busy ? (
              <View style={styles.modifyHint}>
                <Ionicons
                  name="arrow-back"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={styles.modifyHintText}>
                  Tap this to{'\n'}modify details
                </Text>
              </View>
            ) : null}
          </View>

          {error ? (
            <View style={styles.errorBubble}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.totalText}>
            Total: ${queueTotal.toFixed(2)}
          </Text>

          <View style={styles.shutterRow}>
            <View style={styles.shutterSide} />
            <ShutterButton
              onPress={handleShutter}
              loading={busy}
              disabled={busy}
            />
            <View style={[styles.shutterSide, styles.shutterRight]}>
              <Pressable
                onPress={onNext}
                disabled={queueCount === 0}
                style={[
                  styles.nextButton,
                  queueCount === 0 && styles.nextButtonDisabled,
                ]}
              >
                <Text style={styles.nextText}>Next</Text>
                <Ionicons name="arrow-forward" size={15} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/* Match review sheet */}
      {cropUri ? (
        <MatchReviewSheet
          uri={cropUri}
          match={match}
          variantOptions={variantOptions}
          otherMatches={otherMatches}
          onRetake={handleResetScan}
          onConfirm={handleConfirm}
          onSelectMatch={handleSelectMatch}
        />
      ) : null}

      {/* Debug overlay */}
      {debugOpen ? (
        <View style={[styles.debugPanel, { top: insets.top + 52 }]}>
          <Text style={styles.debugTitle}>Scan debug</Text>
          {debugInfo ? (
            <>
              <Text style={styles.debugText}>
                Crop conf:{' '}
                {debugInfo.cropConfidence?.toFixed(2) ?? 'n/a'}
                {debugInfo.usedGuideFallback ? ' (guide fallback)' : ''}
              </Text>
              <Text style={styles.debugText}>
                Number: {debugInfo.numberText ?? '—'}
              </Text>
              <Text style={styles.debugText}>
                Method: {debugInfo.method ?? '—'} · conf{' '}
                {debugInfo.confidence?.toFixed(2) ?? '—'} · autoConfirm{' '}
                {debugInfo.autoConfirm ? 'yes' : 'no'}
              </Text>
              <Text style={styles.debugText} numberOfLines={4}>
                Top: {debugInfo.topText || '—'}
              </Text>
              <Text style={styles.debugText} numberOfLines={4}>
                Bottom: {debugInfo.bottomText || '—'}
              </Text>
            </>
          ) : (
            <Text style={styles.debugText}>No scan yet.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  text: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  topIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: 'rgba(4,6,10,0.55)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
  },
  trayLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  hintBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(10,12,15,0.75)',
    maxWidth: 240,
  },
  hintText: {
    color: colors.text,
    fontSize: 13,
  },
  hintBold: {
    fontWeight: 'bold',
    color: '#2dd4bf',
  },
  lastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(10,12,15,0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 200,
  },
  lastThumb: {
    width: 38,
    height: 52,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  lastInfo: {
    marginLeft: 8,
    flexShrink: 1,
  },
  lastName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  lastMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  lastPrice: {
    color: '#2dd4bf',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 1,
  },
  modifyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  modifyHintText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  errorBubble: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
  },
  totalText: {
    alignSelf: 'flex-end',
    color: '#2dd4bf',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  shutterSide: {
    flex: 1,
  },
  shutterRight: {
    alignItems: 'flex-end',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  nextButtonDisabled: {
    opacity: 0.4,
  },
  nextText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  debugPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(10,12,15,0.9)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  debugTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  debugText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
    fontFamily: 'monospace',
  },
});
