import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { colors } from './src/constants/colors';
import { loadTestCatalog } from './src/services/catalog/TestCatalogProvider';
import { startPrecompute } from './src/services/visual/EmbeddingCache';

type Tab = 'scan' | 'queue' | 'catalog';

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');

  useEffect(() => {
    loadTestCatalog().then((catalog) => {
      console.log('App: warming visual embedding cache', catalog.length, 'cards');
      startPrecompute(catalog);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {tab === 'scan' ? (
          <ScannerScreen />
        ) : tab === 'queue' ? (
          <QueueScreen />
        ) : (
          <HomeScreen />
        )}
        <View style={styles.tabBar}>
          <TabButton active={tab === 'scan'} label="Scan" onPress={() => setTab('scan')} />
          <TabButton active={tab === 'queue'} label="Queue" onPress={() => setTab('queue')} />
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
