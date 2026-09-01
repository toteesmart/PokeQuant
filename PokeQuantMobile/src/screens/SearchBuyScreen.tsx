import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';

export function SearchBuyScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search & Buy</Text>
      <Text style={styles.subtitle}>Find cards and run cash offers.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
  },
});
