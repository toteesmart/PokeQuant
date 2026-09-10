import { useState, useCallback } from 'react';
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
import { cropCard } from '../services/crop/ImageCropper';

export function ScannerScreen() {
  const camera = useCameraSetup();
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [usedGuideFallback, setUsedGuideFallback] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShutter = useCallback(async () => {
    if (!camera.ready) return;
    setIsCapturing(true);
    setError(null);
    try {
      const { filePath } = await camera.takePhoto();
      const uri = `file://${filePath}`;
      setCapturedUri(uri);
      setIsCropping(true);
      const crop = await cropCard(filePath);
      setCropUri(crop.uri);
      setCropConfidence(crop.detection?.confidence ?? null);
      setUsedGuideFallback(crop.usedGuideFallback);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera]);

  const handleRetake = useCallback(() => {
    setCapturedUri(null);
    setCropUri(null);
    setCropConfidence(null);
    setUsedGuideFallback(false);
    setError(null);
  }, []);

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

  if (cropUri) {
    return (
      <CropPreview
        uri={cropUri}
        confidence={cropConfidence}
        usedGuideFallback={usedGuideFallback}
        onRetake={handleRetake}
      />
    );
  }

  return (
    <View style={styles.container}>
      {isCropping ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.text}>Cropping card...</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <ScannerView
          device={camera.device}
          photoOutput={camera.photoOutput}
          onShutter={handleShutter}
          isCapturing={isCapturing}
        />
      )}
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
  error: {
    color: colors.error,
    marginTop: 12,
    textAlign: 'center',
  },
});
