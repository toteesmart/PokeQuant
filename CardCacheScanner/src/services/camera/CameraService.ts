import { useCameraPermission } from 'react-native-vision-camera';

export function useCameraPermissionState() {
  return useCameraPermission();
}
