import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { SyncButton } from '../components/SyncButton';
import { HomeScreen } from '../screens/HomeScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { SearchBuyScreen } from '../screens/SearchBuyScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useProgressStore } from '../store/progressStore';

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.error,
  },
};

const Tab = createBottomTabNavigator();

function HeaderTitle({ children }: { children: string }) {
  const isDownloading = useProgressStore(
    (state) => state.isDownloadingImages
  );
  const progress = useProgressStore((state) => state.imageDownloadProgress);
  const label = useProgressStore((state) => state.imageDownloadLabel);

  if (isDownloading) {
    const pct = Math.round(progress * 100);
    return (
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{label}</Text>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${pct}%` }]}
          />
        </View>
      </View>
    );
  }

  return <Text style={styles.headerTitle}>{children}</Text>;
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <TouchableOpacity onPress={logout} style={styles.logoutButton} activeOpacity={0.7}>
      <Text style={styles.logoutText}>Log Out</Text>
    </TouchableOpacity>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerLeft: () => <SyncButton />,
          headerRight: () => <LogoutButton />,
          headerTitle: ({ children }) => <HeaderTitle>{children}</HeaderTitle>,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 56,
          },
          tabBarLabelStyle: {
            fontSize: 10,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
        }}>
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Inventory"
          component={InventoryScreen}
          options={{
            tabBarLabel: 'Inventory',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="albums-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Search"
          component={SearchBuyScreen}
          options={{
            tabBarLabel: 'Search & Buy',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  logoutButton: {
    marginRight: 16,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  logoutText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  headerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  progressTrack: {
    width: 120,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});
