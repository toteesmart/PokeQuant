import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

type AuthMode = 'signin' | 'signup' | 'reset';

const PRIMARY_GREEN = '#238636';

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.includes('@');
}

export function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, signUp, resetPassword } = useAuth();
  const { triggerSync, isSyncing } = useInventory();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isBusy = isLoading || isSyncing;

  const isSignIn = mode === 'signin';
  const isSignUp = mode === 'signup';
  const isReset = mode === 'reset';

  const canSubmit =
    isValidEmail(email) &&
    (isReset ||
      (isSignIn && password.length > 0) ||
      (isSignUp && password.length > 0 && username.trim().length > 0));

  const handleSignIn = async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      const session = await signIn(email.trim(), password);
      if (session && mountedRef.current) {
        await triggerSync(session.user.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      Alert.alert('Sign in failed', message);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSignUp = async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      const session = await signUp(
        email.trim(),
        password,
        username.trim()
      );
      if (session && mountedRef.current) {
        await triggerSync(session.user.id);
      } else if (mountedRef.current) {
        Alert.alert(
          'Account created',
          'Please check your email to confirm your account before signing in.'
        );
        setMode('signin');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      Alert.alert('Sign up failed', message);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleReset = async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      await resetPassword(email.trim());
      if (mountedRef.current) {
        Alert.alert(
          'Password reset sent',
          'Check your email for a password reset link.'
        );
        setMode('signin');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Password reset failed';
      Alert.alert('Password reset failed', message);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handlePrimary = () => {
    if (!canSubmit || isBusy) return;
    if (isReset) {
      handleReset();
    } else if (isSignUp) {
      handleSignUp();
    } else {
      handleSignIn();
    }
  };

  const primaryLabel = isReset
    ? 'Send Reset Email'
    : isSignUp
    ? 'Create Account'
    : 'Sign In';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.branding}>
            <Text style={styles.title}>PokeQuant</Text>
            <Text style={styles.subtitle}>Vendor Workspace</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="vendor@example.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              editable={!isBusy}
            />

            {!isReset && (
              <>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  editable={!isBusy}
                />
              </>
            )}

            {isSignUp && (
              <>
                <Text style={styles.label}>Username</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your username"
                  placeholderTextColor={colors.textMuted}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  editable={!isBusy}
                />
              </>
            )}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!canSubmit || isBusy) && styles.primaryButtonDisabled,
              ]}
              activeOpacity={0.8}
              disabled={!canSubmit || isBusy}
              onPress={handlePrimary}>
              {isBusy ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
              )}
            </TouchableOpacity>

            {isSignIn && (
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[
                    styles.ghostButton,
                    isBusy && styles.ghostButtonDisabled,
                  ]}
                  activeOpacity={0.8}
                  disabled={isBusy}
                  onPress={() => {
                    setMode('signup');
                    setPassword('');
                  }}>
                  <Text style={styles.ghostButtonText}>Create Account</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linkButton}
                  activeOpacity={0.8}
                  disabled={isBusy}
                  onPress={() => {
                    setMode('reset');
                    setPassword('');
                  }}>
                  <Text style={styles.linkText}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>
            )}

            {(isSignUp || isReset) && (
              <View style={styles.footer}>
                <TouchableOpacity
                  style={styles.linkButton}
                  activeOpacity={0.8}
                  disabled={isBusy}
                  onPress={() => {
                    setMode('signin');
                    setPassword('');
                    setUsername('');
                  }}>
                  <Text style={styles.linkText}>
                    {isSignUp
                      ? 'Already have an account? Sign In'
                      : 'Back to Sign In'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
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
    backgroundColor: PRIMARY_GREEN,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    marginTop: 20,
    gap: 12,
  },
  ghostButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ghostButtonDisabled: {
    opacity: 0.5,
  },
  ghostButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  linkText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
