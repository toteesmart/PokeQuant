import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import type { CameraDevice, CameraPhotoOutput } from 'react-native-vision-camera';
import { CardGuideOverlay } from '../atoms/CardGuideOverlay';
import { colors } from '../../constants/colors';

type Props = {
  device: CameraDevice;
  photoOutput: CameraPhotoOutput;
  isActive?: boolean;
  onStarted?: () => void;
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

export function CameraPreview({
  device,
  photoOutput,
  isActive = true,
  onStarted,
  onStopped,
  onError,
}: Props) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        outputs={[photoOutput]}
        orientationSource="interface"
        enableNativeZoomGesture
        enableNativeTapToFocusGesture
        onStarted={onStarted}
        onStopped={onStopped}
        onError={onError}
      />
      <CardGuideOverlay width={width} height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
