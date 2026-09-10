import { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { useCameraSetup } from '../services/camera/useCameraSetup';
import { ScannerView } from '../molecules/ScannerView';
import { CropPreview } from '../molecules/CropPreview';

export function ScannerScreen() {
  const camera = useCameraSetup();
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [usedGuideFallback, setUsedGuideFallback] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShutter = useCallback(async () => {
    if (!camera.ready) return;
    setIsCapturing(true);
    setError(null);
    try {
      const result = await camera.takePhoto();
      setCapturedUri(result.capturedUri);
      setCropUri(result.uri);
      setCropConfidence(result.detection?.confidence ?? null);
      setUsedGuideFallback(result.usedGuideFallback);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
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
      <View style={styles.container}>
        <CropPreview
          uri={cropUri}
          confidence={cropConfidence}
          usedGuideFallback={usedGuideFallback}
          onRetake={handleRetake}
        />
        {capturedUri ? (
          <Image
            source={{ uri: capturedUri }}
            style={styles.thumbnail}
            contentFit="cover"
            cachePolicy="none"
          />
        ) : null}
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
      />
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
  thumbnail: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  error: {
    color: colors.error,
    margin: 12,
    textAlign: 'center',
  },
});
