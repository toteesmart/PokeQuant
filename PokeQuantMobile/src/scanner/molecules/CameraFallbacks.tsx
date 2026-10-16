import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { scannerScreenStyles as styles } from './scannerScreenStyles';

export function CameraPermissionView({
  canRequestPermission,
  onRequestPermission,
  onRetryCamera,
  onClose,
}: {
  canRequestPermission: boolean;
  onRequestPermission: () => void;
  onRetryCamera: () => void;
  onClose?: () => void;
}) {
  return (
    <View style={styles.centered}>
      <Text style={styles.text}>Camera permission is required.</Text>
      {canRequestPermission ? (
        <Pressable onPress={onRequestPermission} style={styles.button}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => Linking.openSettings()} style={styles.button}>
          <Text style={styles.buttonText}>Open Settings</Text>
        </Pressable>
      )}
      <Pressable onPress={onRetryCamera} style={[styles.button, styles.buttonSecondary]}>
        <Text style={styles.buttonSecondaryText}>Retry</Text>
      </Pressable>
      {onClose ? (
        <Pressable onPress={onClose} style={[styles.button, styles.buttonSecondary]}>
          <Text style={styles.buttonSecondaryText}>Back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CameraInitView({ onRetryCamera }: { onRetryCamera: () => void }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.text}>Initializing camera...</Text>
      <Pressable onPress={onRetryCamera} style={[styles.button, styles.buttonSecondary]}>
        <Text style={styles.buttonSecondaryText}>Tap if camera doesn&rsquo;t start</Text>
      </Pressable>
    </View>
  );
}
