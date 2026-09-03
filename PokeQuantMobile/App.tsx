import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { InventoryProvider } from './src/context/InventoryContext';
import { VendorSettingsProvider } from './src/context/VendorSettingsContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';

function Root() {
  const { userId } = useAuth();
  return userId ? <AppNavigator /> : <LoginScreen />;
}

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
