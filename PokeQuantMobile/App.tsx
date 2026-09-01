import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { VendorSettingsProvider } from './src/context/VendorSettingsContext';
import { InventoryProvider } from './src/context/InventoryContext';
import { CartProvider } from './src/context/CartContext';
import { TourProvider } from './src/context/TourContext';
import { LoginScreen } from './src/screens/LoginScreen';

function Root() {
  const { isLoggedIn, login } = useAuth();
  return isLoggedIn ? <AppNavigator /> : <LoginScreen onLogin={login} />;
}

export default function App() {
  return (
    <AuthProvider>
      <VendorSettingsProvider>
        <InventoryProvider>
          <CartProvider>
            <TourProvider>
              <SafeAreaProvider>
                <Root />
                <StatusBar style="light" />
              </SafeAreaProvider>
            </TourProvider>
          </CartProvider>
        </InventoryProvider>
      </VendorSettingsProvider>
    </AuthProvider>
  );
}
