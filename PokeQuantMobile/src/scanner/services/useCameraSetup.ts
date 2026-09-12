import { useEffect, useCallback, useRef } from 'react';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  CommonResolutions,
} from 'react-native-vision-camera';
import type {
  CameraPhotoOutput,
  CameraDevice,
  Photo,
  PermissionStatus,
} from 'react-native-vision-camera';

type UseCameraSetupResult =
  | {
      ready: false;
      hasPermission: boolean;
      canRequestPermission: boolean;
      status: PermissionStatus;
      requestPermission: () => Promise<boolean>;
      device: undefined;
      photoOutput: undefined;
      takePhoto: undefined;
    }
  | {
      ready: true;
      hasPermission: boolean;
      canRequestPermission: boolean;
      status: PermissionStatus;
      requestPermission: () => Promise<boolean>;
      device: CameraDevice;
      photoOutput: CameraPhotoOutput;
      takePhoto: () => Promise<Photo>;
    };

export function useCameraSetup(): UseCameraSetupResult {
  const {
    hasPermission,
    canRequestPermission,
    status,
    requestPermission,
  } = useCameraPermission();
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
      canRequestPermission,
      status,
      requestPermission,
      device: undefined,
      photoOutput: undefined,
      takePhoto: undefined,
    };
  }

  return {
    ready: true,
    hasPermission,
    canRequestPermission,
    status,
    requestPermission,
    device,
    photoOutput,
    takePhoto,
  };
}

export { Camera };
