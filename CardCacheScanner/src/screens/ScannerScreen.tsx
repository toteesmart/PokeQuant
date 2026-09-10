import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Photo } from 'react-native-vision-camera';
import type { Image } from 'react-native-nitro-image';
import { colors } from '../constants/colors';
import { useCameraSetup } from '../services/camera/useCameraSetup';
import { ScannerView } from '../molecules/ScannerView';
import { CropPreview } from '../molecules/CropPreview';
import { cropImage } from '../services/crop/ImageCropper';

export function ScannerScreen() {
  const camera = useCameraSetup();
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropConfidence, setCropConfidence] = useState<number | null>(null);
  const [usedGuideFallback, setUsedGuideFallback] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoRef = useRef<Photo | null>(null);
  const imageRef = useRef<Image | null>(null);

  const cleanup = useCallback(() => {
    photoRef.current?.dispose();
    imageRef.current?.dispose();
    photoRef.current = null;
    imageRef.current = null;
  }, []);

  const handleShutter = useCallback(async () => {
    if (!camera.ready || isCapturing || isCropping) return;
    setIsCapturing(true);
    setError(null);
    cleanup();

    let capturedPhoto: Photo | undefined;
    let capturedImage: Image | undefined;

    try {
      ({ photo: capturedPhoto, image: capturedImage } = await camera.takePhoto());
      photoRef.current = capturedPhoto;
      imageRef.current = capturedImage;
      setIsCapturing(false);
      setIsCropping(true);

      // Resize to its own logical dimensions to bake the iOS imageOrientation
      // flag into the actual pixels. The output is an upright, .up image.
      const uprightImage = await capturedImage.resizeAsync(
        capturedImage.width,
        capturedImage.height
      );
      capturedImage.dispose();
      imageRef.current = uprightImage;

      const crop = await cropImage(uprightImage);
      setCropUri(crop.uri);
      setCropConfidence(crop.detection?.confidence ?? null);
      setUsedGuideFallback(crop.usedGuideFallback);

      uprightImage.dispose();
      photoRef.current?.dispose();
      photoRef.current = null;
      imageRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera, isCapturing, isCropping, cleanup]);

  const handleRetake = useCallback(() => {
    cleanup();
    setCropUri(null);
    setCropConfidence(null);
    setUsedGuideFallback(false);
    setError(null);
  }, [cleanup]);

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
      <ScannerView
        device={camera.device}
        photoOutput={camera.photoOutput}
        onShutter={handleShutter}
        isCapturing={isCapturing}
        isCropping={isCropping}
      />
      {isCropping ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.overlayText}>Cropping card...</Text>
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
  error: {
    color: colors.error,
    margin: 12,
    textAlign: 'center',
  },
});
