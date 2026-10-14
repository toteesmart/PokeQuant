import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { AppButton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useInventoryStore } from '../store/inventoryStore';
import { toErrorMessage } from '../utils/log';

type AuthMode = 'signin' | 'signup' | 'reset';

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
  const triggerSync = useInventoryStore((state) => state.triggerSync);
  const isSyncing = useInventoryStore((state) => state.isSyncing);
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
      Alert.alert('Sign in failed', toErrorMessage(err));
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
      Alert.alert('Sign up failed', toErrorMessage(err));
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
      Alert.alert('Password reset failed', toErrorMessage(err));
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
            <Image
              source={require('../../toteesmartlogo.jpg')}
              style={styles.logo}
            />
            <Text style={styles.title}>Card Cache</Text>
            <Text style={styles.subtitle}>by Totees Mart</Text>
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

            <AppButton
              title={primaryLabel}
              onPress={handlePrimary}
              disabled={!canSubmit || isBusy}
              loading={isBusy}
            />

            {isSignIn && (
              <View style={styles.footer}>
                <AppButton
                  title="Create account"
                  variant="ghost"
                  disabled={isBusy}
                  onPress={() => {
                    setMode('signup');
                    setPassword('');
                  }}
                />

                <Pressable
                  style={styles.linkButton}
                  disabled={isBusy}
                  hitSlop={7}
                  onPress={() => {
                    setMode('reset');
                    setPassword('');
                  }}
                  accessibilityRole="button">
                  <Text style={styles.linkText}>Forgot Password?</Text>
                </Pressable>
              </View>
            )}

            {(isSignUp || isReset) && (
              <View style={styles.footer}>
                <Pressable
                  style={styles.linkButton}
                  disabled={isBusy}
                  hitSlop={7}
                  onPress={() => {
                    setMode('signin');
                    setPassword('');
                    setUsername('');
                  }}
                  accessibilityRole="button">
                  <Text style={styles.linkText}>
                    {isSignUp
                      ? 'Already have an account? Sign in'
                      : 'Back to sign in'}
                  </Text>
                </Pressable>
              </View>
            )}

            <View style={styles.socialFooter}>
              <Pressable
                style={styles.socialButton}
                hitSlop={6}
                onPress={() =>
                  Linking.openURL('https://instagram.com/totees.mart')
                }
                accessibilityRole="button">
                <Text style={styles.socialButtonText}>
                  Follow @totees.mart
                </Text>
              </Pressable>

              <Pressable
                style={styles.socialButton}
                hitSlop={6}
                onPress={() =>
                  Linking.openURL('https://discord.gg/CHzYb6YrkF')
                }
                accessibilityRole="button">
                <Text style={styles.socialButtonText}>Join the Discord</Text>
              </Pressable>
            </View>
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
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  branding: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 999,
    marginBottom: 16,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
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
    backgroundColor: colors.overlay3,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  footer: {
    marginTop: 20,
    gap: 12,
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
  socialFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 24,
  },
  socialButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.overlay2,
    alignItems: 'center',
  },
  socialButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
});
