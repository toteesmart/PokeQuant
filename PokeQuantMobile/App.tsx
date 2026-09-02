import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
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
            <Root />
            <StatusBar style="light" />
          </InventoryProvider>
        </VendorSettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
