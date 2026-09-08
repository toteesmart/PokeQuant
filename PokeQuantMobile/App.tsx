import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors } from './src/constants/colors';
import { useAuthStore } from './src/store/authStore';
import { useSubscriptionStore } from './src/store/subscriptionStore';
import { SetupGate } from './src/components/SetupGate';
import { SubscriptionGate } from './src/components/SubscriptionGate';

function Root() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.userId);
  if (isLoading) {
    return <View style={styles.splash} />;
  }
  return userId ? (
    <SetupGate>
      <SubscriptionGate>
        <AppNavigator />
      </SubscriptionGate>
    </SetupGate>
  ) : (
    <LoginScreen />
  );
}

function StoreInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    // Configure RevenueCat as early as possible (no-op if no key is set).
    useSubscriptionStore.getState().configure();
    initialize().catch((err) => {
      console.error('Auth initialization failed:', err);
    });
  }, [initialize]);

  // Sync is intentionally manual-only. Auto-sync on foreground or mutations
  // was causing multi-second UI freezes for large inventories.

  return children;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreInitializer>
        <Root />
        <StatusBar style="light" />
      </StoreInitializer>
    </SafeAreaProvider>
  );
}
