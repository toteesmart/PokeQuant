import { useEffect, useCallback, useRef } from 'react';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  CommonResolutions,
} from 'react-native-vision-camera';
import type { CameraPhotoOutput, CameraDevice, Photo } from 'react-native-vision-camera';
import type { Image } from 'react-native-nitro-image';

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
      takePhoto: () => Promise<{ image: Image; capturedUri: string }>;
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

  const takePhoto = useCallback(async () => {
    const photo: Photo = await photoOutput.capturePhoto(
      {
        flashMode: 'off',
        enableShutterSound: !shutterSoundPlayed.current,
      },
      {}
    );
    shutterSoundPlayed.current = true;

    let image = await photo.toImageAsync();
    photo.dispose();

    // VisionCamera's Photo.toImageAsync() preserves the iOS imageOrientation flag
    // rather than baking it into pixels. Force a physical 0° re-render so that
    // crop/resize/toRawPixelData all work in the same upright coordinate space.
    image = await image.rotateAsync(0, false);

    // Save an upright copy for display/fallback.
    const displayPath = await image.saveToTemporaryFileAsync('jpg', 95);

    return {
      image,
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
