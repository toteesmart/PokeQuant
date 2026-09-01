import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { initializeDatabase, type InitResult } from './src/db/database';

export default function App() {
  const [status, setStatus] = useState<InitResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    initializeDatabase()
      .then((result) => {
        if (!cancelled) {
          setStatus(result);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            db: null as never,
            ok: false,
            message: `SQLite Init Failed: ${error instanceof Error ? error.message : String(error)}`,
          });
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PokeQuant Mobile</Text>
      {isLoading ? (
        <>
          <ActivityIndicator size="large" />
          <Text style={styles.status}>Initializing SQLite...</Text>
        </>
      ) : (
        <Text
          style={[
            styles.status,
            status?.ok ? styles.success : styles.error,
          ]}>
          {status?.message ?? 'Unknown status'}
        </Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  status: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  success: {
    color: '#2e7d32',
    fontWeight: '600',
  },
  error: {
    color: '#c62828',
    fontWeight: '600',
  },
});
