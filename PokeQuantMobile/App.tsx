import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors } from './src/constants/colors';
import { useVendorStore } from './src/store/vendorStore';
import { useInventoryStore } from './src/store/inventoryStore';
import { useShowVendorStore } from './src/store/showVendorStore';
import { useAuthStore } from './src/store/authStore';

function Root() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.userId);
  if (isLoading) {
    return <View style={styles.splash} />;
  }
  return userId ? <AppNavigator /> : <LoginScreen />;
}

function StoreInitializer({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((state) => state.userId);
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize().catch((err) => {
      console.error('Auth initialization failed:', err);
    });
  }, [initialize]);

  useEffect(() => {
    useVendorStore.getState().loadForUser(userId);
    useInventoryStore.getState().loadForUser(userId);
    if (userId) {
      useShowVendorStore.getState().loadVendorProfile();
    }
  }, [userId]);

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
