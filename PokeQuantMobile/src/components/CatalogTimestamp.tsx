import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../constants/colors';
import { useProgressStore } from '../store/progressStore';

export function CatalogTimestamp() {
  const catalogLastUpdated = useProgressStore((state) => state.catalogLastUpdated);

  const label = useMemo(() => {
    if (catalogLastUpdated == null) {
      return 'Prices: not downloaded yet';
    }

    const date = new Date(catalogLastUpdated);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

    return isToday ? `Prices: Today, ${time}` : `Prices: ${time}`;
  }, [catalogLastUpdated]);

  return <Text style={styles.timestampText}>{label}</Text>;
}

const styles = StyleSheet.create({
  timestampText: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
});
