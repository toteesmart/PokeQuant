import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors } from './src/constants/colors';
import { useVendorStore } from './src/store/vendorStore';
import { useInventoryStore } from './src/store/inventoryStore';

function Root() {
  const { userId, isLoading } = useAuth();
  if (isLoading) {
    return <View style={styles.splash} />;
  }
  return userId ? <AppNavigator /> : <LoginScreen />;
}

function StoreInitializer({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();

  useEffect(() => {
    useVendorStore.getState().loadForUser(userId);
    useInventoryStore.getState().loadForUser(userId);
  }, [userId]);

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
      <AuthProvider>
        <StoreInitializer>
          <Root />
          <StatusBar style="light" />
        </StoreInitializer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
