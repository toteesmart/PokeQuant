import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { colors } from './src/constants/colors';
import { loadFullCatalog } from './src/services/catalog/FullCatalogProvider';
import { loadBinarySidecar, startPrecompute } from './src/services/visual/EmbeddingCache';

type Tab = 'scan' | 'queue' | 'catalog';

export default function App() {
  const [tab, setTab] = useState<Tab>('scan');
  const [isSidecarLoading, setIsSidecarLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      loadBinarySidecar(),
      loadFullCatalog(),
    ])
      .then(([_, catalog]) => {
        console.log('App: sidecar + full catalog ready', catalog.length, 'cards');
        setIsSidecarLoading(false);
        startPrecompute(catalog);
      })
      .catch((e) => {
        console.warn('App: failed to load sidecar or catalog', e);
        setIsSidecarLoading(false);
      });
  }, []);

  if (isSidecarLoading) {
    return (
      <SafeAreaProvider>
        <View style={[styles.container, styles.loading]}>
          <Text style={styles.loadingText}>Loading scanner catalog…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

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
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.text,
    fontSize: 18,
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
