import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../constants/colors';

export type InventoryTab = 'active' | 'analytics';

type SegmentedTabBarProps = {
  activeTab: InventoryTab;
  onChange: (tab: InventoryTab) => void;
};

const TABS: { key: InventoryTab; label: string }[] = [
  { key: 'active', label: 'Active Inventory' },
  { key: 'analytics', label: 'Performance Analytics' },
];

export function SegmentedTabBar({ activeTab, onChange }: SegmentedTabBarProps) {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.activeTab]}
            activeOpacity={0.8}
            onPress={() => onChange(tab.key)}>
            <Text
              style={[styles.tabText, isActive && styles.activeTabText]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    marginHorizontal: 4,
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  activeTabText: {
    color: colors.text,
    fontWeight: 'bold',
  },
});
