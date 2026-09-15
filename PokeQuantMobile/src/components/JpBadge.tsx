import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';

// Small gold chip marking a Japanese printing — EN and JP market prices
// diverge hard, so the language needs to be visible at a glance.
export const JpBadge = memo(function JpBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>JP</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    backgroundColor: 'rgba(210, 153, 34, 0.18)',
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 4,
    alignSelf: 'center',
  },
  text: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
