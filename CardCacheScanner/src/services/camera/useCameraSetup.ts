import { useEffect, useCallback, useRef } from 'react';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  CommonResolutions,
} from 'react-native-vision-camera';
import type { CameraPhotoOutput, CameraDevice, Photo } from 'react-native-vision-camera';

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
      takePhoto: () => Promise<Photo>;
    };

export function useCameraSetup(): UseCameraSetupResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle'],
  });
  const photoOutput = usePhotoOutput({
    targetResolution: CommonResolutions.HD_4_3,
    containerFormat: 'jpeg',
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
    const photo = await photoOutput.capturePhoto(
      {
        flashMode: 'off',
        enableShutterSound: !shutterSoundPlayed.current,
      },
      {}
    );
    shutterSoundPlayed.current = true;
    return photo;
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
