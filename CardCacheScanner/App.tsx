import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { colors } from './src/constants/colors';

type Tab = 'scan' | 'catalog';

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {tab === 'scan' ? <ScannerScreen /> : <HomeScreen />}
        <View style={styles.tabBar}>
          <TabButton active={tab === 'scan'} label="Scan" onPress={() => setTab('scan')} />
          <TabButton active={tab === 'catalog'} label="Catalog" onPress={() => setTab('catalog')} />
        </View>
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderTopWidth: 2,
    borderTopColor: colors.primary,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: 'bold',
  },
});
