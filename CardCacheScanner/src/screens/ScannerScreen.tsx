import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { useCameraSetup } from '../services/camera/useCameraSetup';
import { ScannerView } from '../molecules/ScannerView';
import { CropPreview } from '../molecules/CropPreview';
import { processPhoto } from '../services/scanner/processPhoto';
import type { OcrResult } from '../services/ocr/TextRecognition';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import type { VisualMatch } from '../services/visual/visualMatcher';
import { createScannedCard, type ConditionCode } from '../types/scan';
import { useScanQueueStore } from '../store/scanQueueStore';

const DEFAULT_AUTO_CONFIRM_CONDITION: ConditionCode = 'NM';
const DEFAULT_AUTO_CONFIRM_QUANTITY = 1;

export function ScannerScreen() {
  const camera = useCameraSetup();
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [usedGuideFallback, setUsedGuideFallback] = useState(false);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [match, setMatch] = useState<CatalogMatch | null>(null);
  const [visualMatches, setVisualMatches] = useState<VisualMatch[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoAdded, setAutoAdded] = useState<string | null>(null);

  const handleRetake = useCallback(() => {
    setCropUri(null);
    setCropConfidence(null);
    setUsedGuideFallback(false);
    setOcr(null);
    setMatch(null);
    setVisualMatches([]);
    setError(null);
    setAutoAdded(null);
  }, []);

  const handleSelectMatch = useCallback((selected: CatalogMatch) => {
    console.log('ScannerScreen: selected match', selected.card.name, selected.confidence.toFixed(3));
    setMatch(selected);
  }, []);

  const handleConfirm = useCallback((condition: ConditionCode, quantity: number) => {
    if (!match?.card) return;
    const item = createScannedCard(match.card, condition, quantity);
    useScanQueueStore.getState().add(item);
    handleRetake();
  }, [match, handleRetake]);

  const handleShutter = useCallback(async () => {
    if (!camera.ready || isCapturing || isCropping) return;
    setIsCapturing(true);
    setError(null);
    setAutoAdded(null);

    try {
      console.log('ScannerScreen: capture start');
      const photo = await camera.takePhoto();
      console.log('ScannerScreen: capture done', photo.width, photo.height);
      setIsCapturing(false);
      setIsCropping(true);

      console.log('ScannerScreen: process start');
      const crop = await processPhoto(photo);
      console.log('ScannerScreen: process done', crop.uri);

      setCropUri(crop.uri);
      setCropConfidence(crop.detection?.confidence ?? null);
      setUsedGuideFallback(crop.usedGuideFallback);
      setOcr(crop.ocr);
      setMatch(crop.match);
      setVisualMatches(crop.visualMatches);
      console.log('ScannerScreen: state set', 'autoConfirm', crop.fusion.autoConfirm);

      if (crop.fusion.autoConfirm && crop.match?.card) {
        const item = createScannedCard(
          crop.match.card,
          DEFAULT_AUTO_CONFIRM_CONDITION,
          DEFAULT_AUTO_CONFIRM_QUANTITY
        );
        useScanQueueStore.getState().add(item);
        setAutoAdded(crop.match.card.name);
        handleRetake();
      }
    } catch (e) {
      console.error('ScannerScreen: error', e);
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera, isCapturing, isCropping, handleRetake]);

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
      <ScannerView
        device={camera.device}
        photoOutput={camera.photoOutput}
        onShutter={handleShutter}
        isCapturing={isCapturing}
        isCropping={isCropping}
        isActive={!cropUri}
      />
      {isCropping ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.overlayText}>Cropping card...</Text>
        </View>
      ) : null}
      {autoAdded ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Auto-added {autoAdded}</Text>
        </View>
      ) : null}
      {cropUri ? (
        <View style={styles.cropOverlay}>
          <CropPreview
            uri={cropUri}
            confidence={cropConfidence}
            usedGuideFallback={usedGuideFallback}
            ocr={ocr}
            match={match}
            visualMatches={visualMatches}
            onRetake={handleRetake}
            onConfirm={handleConfirm}
            onSelectMatch={handleSelectMatch}
          />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    color: colors.text,
    fontSize: 16,
    marginTop: 12,
  },
  cropOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  toast: {
    position: 'absolute',
    top: 60,
    left: 24,
    right: 24,
    backgroundColor: colors.success,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    zIndex: 10,
  },
  toastText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  error: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    color: colors.error,
    textAlign: 'center',
  },
});
