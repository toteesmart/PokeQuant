import { StyleSheet, Text, View } from 'react-native';
import { CameraPreview } from '../atoms/CameraPreview';
import { ShutterButton } from '../atoms/ShutterButton';
import { colors } from '../constants/colors';
import type { CameraDevice, CameraPhotoOutput } from 'react-native-vision-camera';
import type { ReactNode } from 'react';

type Props = {
  device: CameraDevice;
  photoOutput: CameraPhotoOutput;
  onShutter: () => void;
  isCapturing: boolean;
  isCropping?: boolean;
  isActive?: boolean;
  rightSlot?: ReactNode;
};

export function ScannerView({
  device,
  photoOutput,
  onShutter,
  isCapturing,
  isCropping,
  isActive = true,
  rightSlot,
}: Props) {
  const busy = isCapturing || isCropping;

  return (
    <View style={styles.container}>
      <CameraPreview device={device} photoOutput={photoOutput} isActive={isActive} />
      <View style={styles.controls}>
        <Text style={styles.hint}>
          {isCropping ? 'Cropping card...' : 'Fit the card in the guide and tap shutter'}
        </Text>
        <ShutterButton onPress={onShutter} loading={busy} disabled={busy} />
        {rightSlot ? (
          <View style={styles.rightSlot} pointerEvents="none">
            {rightSlot}
          </View>
        ) : null}
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
  rightSlot: {
    position: 'absolute',
    right: 12,
    bottom: 48,
  },
});
