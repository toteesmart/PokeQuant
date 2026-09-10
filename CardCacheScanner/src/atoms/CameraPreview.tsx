import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import type { CameraDevice, CameraPhotoOutput } from 'react-native-vision-camera';
import { CardGuideOverlay } from './CardGuideOverlay';
import { colors } from '../constants/colors';

type Props = {
  device: CameraDevice;
  photoOutput: CameraPhotoOutput;
};

export function CameraPreview({ device, photoOutput }: Props) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[photoOutput]}
        orientationSource="interface"
        enableNativeZoomGesture
        enableNativeTapToFocusGesture
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
