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

export function ScannerScreen() {
  const camera = useCameraSetup();
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShutter = useCallback(async () => {
    if (!camera.ready) return;
    setIsCapturing(true);
    setError(null);
    try {
      const { filePath } = await camera.takePhoto();
      setCapturedUri(`file://${filePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to capture photo');
    } finally {
      setIsCapturing(false);
    }
  }, [camera]);

  const handleRetake = useCallback(() => {
    setCapturedUri(null);
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

  return (
    <View style={styles.container}>
      {capturedUri ? (
        <View style={styles.preview}>
          <Image source={{ uri: capturedUri }} style={styles.capturedImage} contentFit="contain" cachePolicy="none" />
          <View style={styles.previewControls}>
            <Pressable onPress={handleRetake} style={styles.button}>
              <Text style={styles.buttonText}>Retake</Text>
            </Pressable>
          </View>
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
  preview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  capturedImage: {
    flex: 1,
    width: '100%',
  },
  previewControls: {
    marginTop: 16,
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
