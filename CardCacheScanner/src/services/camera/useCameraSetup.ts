import { useEffect, useCallback, useRef } from 'react';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  CommonResolutions,
} from 'react-native-vision-camera';
import type { CameraPhotoOutput, CameraDevice } from 'react-native-vision-camera';
import { cropImage, type CropResult } from '../crop/ImageCropper';

type CaptureAndCropResult = CropResult & { capturedUri: string };

type UseCameraSetupResult =
  | {
      ready: false;
      hasPermission: boolean;
      requestPermission: () => Promise<boolean>;
      device: undefined;
      photoOutput: undefined;
      takePhoto: undefined;
    }
  | {
      ready: true;
      hasPermission: boolean;
      requestPermission: () => Promise<boolean>;
      device: CameraDevice;
      photoOutput: CameraPhotoOutput;
      takePhoto: () => Promise<CaptureAndCropResult>;
    };

export function useCameraSetup(): UseCameraSetupResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle'],
  });
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.FHD_4_3,
    quality: 0.92,
    qualityPrioritization: 'balanced',
  });

  const shutterSoundPlayed = useRef(false);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission().catch(() => {});
    }
  }, [hasPermission, requestPermission]);

  const takePhoto = useCallback(async (): Promise<CaptureAndCropResult> => {
    const photo = await photoOutput.capturePhoto(
      {
        flashMode: 'off',
        enableShutterSound: !shutterSoundPlayed.current,
      },
      {}
    );
    shutterSoundPlayed.current = true;

    const capturedImage = await photo.toImageAsync();
    const uprightImage = await capturedImage.rotateAsync(0, false);

    // The in-memory 0° re-render bakes the imageOrientation flag into pixels
    // so detection and crop operate in the same upright coordinate space.
    // Dispose the original Photo.toImageAsync() result once we have the upright copy.
    capturedImage.dispose();

    const displayPath = await uprightImage.saveToTemporaryFileAsync('jpg', 95);
    const crop = await cropImage(uprightImage);

    // Release all in-memory images; we only return file URIs to the UI.
    uprightImage.dispose();
    photo.dispose();

    return {
      ...crop,
      capturedUri: `file://${displayPath}`,
    };
  }, [photoOutput]);

  if (!hasPermission || !device) {
    return {
      ready: false,
      hasPermission,
      requestPermission,
      device: undefined,
      photoOutput: undefined,
      takePhoto: undefined,
    };
  }

  return {
    ready: true,
    hasPermission,
    requestPermission,
    device,
    photoOutput,
    takePhoto,
  };
}

export { Camera };
