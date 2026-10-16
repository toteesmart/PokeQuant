import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { GlassCircle } from './ui/TopChrome';

type Variant = {
  /** 'glass' wraps the icon in the frosted-circle chrome (TopChrome);
   *  'bare' is the plain header/inline form. */
  variant?: 'bare' | 'glass';
};

export function SettingsGear({ variant = 'bare' }: Variant) {
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();
  const icon = <Ionicons name="settings-outline" size={20} color={colors.text} />;
  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Settings')}
      style={variant === 'bare' && styles.button}
      hitSlop={8}
      accessibilityLabel="Settings"
      accessibilityRole="button"
      activeOpacity={0.7}
    >
      {variant === 'glass' ? <GlassCircle>{icon}</GlassCircle> : icon}
    </TouchableOpacity>
  );
}

export function SettingsBackButton({ variant = 'bare' }: Variant) {
  const navigation = useNavigation<NavigationProp<ReactNavigation.RootParamList>>();
  const icon = <Ionicons name="chevron-back" size={24} color={colors.text} />;
  return (
    <TouchableOpacity
      onPress={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('Inventory');
        }
      }}
      style={variant === 'bare' && styles.button}
      hitSlop={8}
      accessibilityLabel="Back"
      accessibilityRole="button"
      activeOpacity={0.7}
    >
      {variant === 'glass' ? <GlassCircle>{icon}</GlassCircle> : icon}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
});
