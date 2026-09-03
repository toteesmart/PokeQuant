import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { InventoryProvider } from './src/context/InventoryContext';
import { VendorSettingsProvider } from './src/context/VendorSettingsContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { colors } from './src/constants/colors';

function Root() {
  const { userId, isLoading } = useAuth();
  if (isLoading) {
    return <View style={styles.splash} />;
  }
  return userId ? <AppNavigator /> : <LoginScreen />;
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
        <VendorSettingsProvider>
          <InventoryProvider>
            <CartProvider>
              <Root />
              <StatusBar style="light" />
            </CartProvider>
          </InventoryProvider>
        </VendorSettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
