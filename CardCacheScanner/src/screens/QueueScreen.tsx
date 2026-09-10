import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../constants/colors';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { useScanQueueStore } from '../store/scanQueueStore';
import type { ConditionCode } from '../types/scan';

export function QueueScreen() {
  const { items, remove, updateCondition, updateQuantity, clear, totalCount, totalPrice } =
    useScanQueueStore();

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Scan Queue</Text>
        <Text style={styles.empty}>No cards yet. Scan one to get started.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Scan Queue ({totalCount()})</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            {item.imageUrl ? (
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.image}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.imagePlaceholder} />
            )}
            <View style={styles.details}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.set} · {item.number}</Text>
              <View style={styles.conditionRow}>
                {CONDITION_CODES.map((code) => (
                  <Pressable
                    key={code}
                    onPress={() => updateCondition(item.id, code)}
                    style={[
                      styles.conditionChip,
                      item.condition === code && styles.conditionChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.conditionCode,
                        item.condition === code && styles.conditionCodeActive,
                      ]}
                    >
                      {code}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.conditionLabel}>{CONDITION_LABELS[item.condition]}</Text>
            </View>
            <View style={styles.right}>
              <View style={styles.quantityRow}>
                <Pressable
                  onPress={() => updateQuantity(item.id, item.quantity - 1)}
                  style={styles.quantityButton}
                >
                  <Text style={styles.quantityButtonText}>-</Text>
                </Pressable>
                <Text style={styles.quantityValue}>{item.quantity}</Text>
                <Pressable
                  onPress={() => updateQuantity(item.id, item.quantity + 1)}
                  style={styles.quantityButton}
                >
                  <Text style={styles.quantityButtonText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.price}>${item.totalPrice.toFixed(2)}</Text>
              <Pressable onPress={() => remove(item.id)} style={styles.removeButton}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total preview</Text>
          <Text style={styles.totalValue}>${totalPrice().toFixed(2)}</Text>
        </View>
        <Pressable onPress={clear} style={styles.clearButton}>
          <Text style={styles.clearText}>Clear queue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 32,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  image: {
    width: 60,
    height: 80,
    borderRadius: 6,
  },
  imagePlaceholder: {
    width: 60,
    height: 80,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  details: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  conditionChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  conditionChipActive: {
    backgroundColor: colors.primary,
  },
  conditionCode: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  conditionCodeActive: {
    color: '#fff',
  },
  conditionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  right: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quantityButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  quantityValue: {
    color: colors.text,
    fontSize: 16,
    minWidth: 24,
    textAlign: 'center',
  },
  price: {
    color: colors.success,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 8,
  },
  removeButton: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colors.error + '22',
  },
  removeText: {
    color: colors.error,
    fontSize: 12,
  },
  footer: {
    marginTop: 12,
    paddingTop: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    color: colors.text,
    fontSize: 18,
  },
  totalValue: {
    color: colors.success,
    fontSize: 24,
    fontWeight: 'bold',
  },
  clearButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  clearText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
