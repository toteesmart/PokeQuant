import { StyleSheet, Text, View } from 'react-native';
import { CameraPreview } from '../atoms/CameraPreview';
import { ShutterButton } from '../atoms/ShutterButton';
import { colors } from '../constants/colors';
import type { CameraDevice, CameraPhotoOutput } from 'react-native-vision-camera';

type Props = {
  device: CameraDevice;
  photoOutput: CameraPhotoOutput;
  onShutter: () => void;
  isCapturing: boolean;
};

export function ScannerView({ device, photoOutput, onShutter, isCapturing }: Props) {
  return (
    <View style={styles.container}>
      <CameraPreview device={device} photoOutput={photoOutput} />
      <View style={styles.controls}>
        <Text style={styles.hint}>Fit the card in the guide and tap shutter</Text>
        <ShutterButton onPress={onShutter} loading={isCapturing} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  hint: {
    color: colors.text,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
});
