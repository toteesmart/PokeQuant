import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';

export function LoginScreen() {
  const [betaKey, setBetaKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const { triggerSync, isSyncing } = useInventory();

  const canSubmit = betaKey.trim().length > 0;

  const handleSyncAndEnter = async () => {
    const key = betaKey.trim();
    if (!key) return;

    setIsLoading(true);

    // Set the authenticated user so the workspace can mount.
    login(key);

    // Immediately push any local state and pull the real cloud inventory
    // for this beta key.
    try {
      await triggerSync(key);
    } catch (err) {
      console.error('Login sync failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.branding}>
          <Text style={styles.title}>PokeQuant</Text>
          <Text style={styles.subtitle}>Vendor Workspace</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Beta Key</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your vendor beta key"
            placeholderTextColor={colors.textMuted}
            value={betaKey}
            onChangeText={setBetaKey}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSyncing && !isLoading}
          />

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!canSubmit || isSyncing || isLoading) && styles.primaryButtonDisabled,
            ]}
            activeOpacity={0.8}
            disabled={!canSubmit || isSyncing || isLoading}
            onPress={handleSyncAndEnter}>
            {isSyncing || isLoading ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.primaryButtonText}>Sync & Enter Workspace</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            Your beta key is your vendor profile. All inventory is scoped to this key.
          </Text>
        </View>
      </View>
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
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
    marginTop: 8,
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
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
});
