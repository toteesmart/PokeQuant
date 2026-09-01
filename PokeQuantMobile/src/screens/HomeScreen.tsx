import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';

export function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>PokeQuant</Text>
      <Text style={styles.subtitle}>Trading terminal ready.</Text>
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
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 16,
  },
});
