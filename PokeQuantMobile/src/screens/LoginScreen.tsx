import { useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';

type LoginScreenProps = {
  onLogin: () => void;
};

const INSTAGRAM_URL = 'https://www.instagram.com/totees.mart/';
const DISCORD_URL = 'https://discord.gg/CHzYb6YrkF';

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [profileName, setProfileName] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const openLink = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  const handleLoginPress = () => {
    if (!profileName.trim()) return;
    setConfirmInput('');
    setConfirmError(null);
    setShowConfirm(true);
  };

  const handleVerify = () => {
    if (confirmInput.trim() === profileName.trim()) {
      setShowConfirm(false);
      onLogin();
    } else {
      setConfirmError('Profile name does not match.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.branding}>
          <View style={styles.logoWrapper}>
            <Image
              // Project-provided logo asset (logo.png; no logo.jpg exists in tree)
              source={require('../../logo.png')}
              style={styles.logo}
              resizeMode="cover"
            />
          </View>
          <View style={styles.titleStack}>
            <Text style={styles.title}>PokeQuant Closed beta</Text>
            <Text style={styles.subtitle}>by Totees Mart</Text>
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Profile Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your profile name"
            placeholderTextColor={colors.textMuted}
            value={profileName}
            onChangeText={setProfileName}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.8}
            onPress={handleLoginPress}>
            <Text style={styles.primaryButtonText}>Log in</Text>
          </TouchableOpacity>

          <View style={styles.socialRow}>
            <TouchableOpacity
              style={styles.socialButton}
              activeOpacity={0.8}
              onPress={() => openLink(INSTAGRAM_URL)}>
              <Text style={styles.socialButtonText}>Instagram: totees.mart</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialButton}
              activeOpacity={0.8}
              onPress={() => openLink(DISCORD_URL)}>
              <Text style={styles.socialButtonText}>Join the Discord</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={showConfirm}
        onRequestClose={() => setShowConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirm Profile Name</Text>
            <Text style={styles.modalBody}>
              You entered:{' '}
              <Text style={styles.modalHighlight}>{profileName}</Text>. Typing
              the wrong ID will create an empty, orphaned workspace.
            </Text>

            <Text style={styles.label}>Re-type Profile Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter your profile name"
              placeholderTextColor={colors.textMuted}
              value={confirmInput}
              onChangeText={setConfirmInput}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {confirmError && (
              <Text style={styles.errorText}>{confirmError}</Text>
            )}

            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={handleVerify}>
              <Text style={styles.primaryButtonText}>Verify & Enter</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              activeOpacity={0.8}
              onPress={() => setShowConfirm(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  branding: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
  },
  logoWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    marginRight: 16,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  titleStack: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  form: {
    width: '100%',
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  socialButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  socialButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  modalHighlight: {
    color: colors.text,
    fontWeight: '600',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    marginBottom: 12,
  },
  cancelButton: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
});
