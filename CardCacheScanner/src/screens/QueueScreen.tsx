import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { CONDITION_CODES, CONDITION_LABELS } from '../constants/conditions';
import { useScanQueueStore } from '../store/scanQueueStore';
import { loadFullCatalog } from '../services/catalog/FullCatalogProvider';
import { findVariantOptions } from '../services/catalog/catalogMatcher';
import type { ConditionCode, ScannedCard } from '../types/scan';
import type { TestCatalogCard } from '../types/catalog';

type Props = {
  onBack?: () => void;
  onDone?: () => void;
};

function nextCondition(code: ConditionCode): ConditionCode {
  const idx = CONDITION_CODES.indexOf(code);
  return CONDITION_CODES[(idx + 1) % CONDITION_CODES.length];
}

export function QueueScreen({ onBack, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const {
    items,
    remove,
    updateCondition,
    updateQuantity,
    replaceCard,
    clear,
    totalCount,
    totalPrice,
  } = useScanQueueStore();

  const [switchItem, setSwitchItem] = useState<ScannedCard | null>(null);
  const [switchOptions, setSwitchOptions] = useState<TestCatalogCard[]>([]);
  const [switchLoading, setSwitchLoading] = useState(false);

  const openSwitcher = (item: ScannedCard) => {
    setSwitchItem(item);
    setSwitchOptions([]);
    setSwitchLoading(true);
    loadFullCatalog()
      .then((catalog) => setSwitchOptions(findVariantOptions(item, catalog)))
      .catch((e) => console.warn('QueueScreen: variant lookup failed', e))
      .finally(() => setSwitchLoading(false));
  };

  const handleAdd = () => {
    clear();
    onDone?.();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Review Your Matches</Text>
        <View style={styles.backButton} />
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>
          No cards yet. Scan one to get started.
        </Text>
      ) : (
        <>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => (
              <Pressable
                key={item.id}
                style={styles.card}
                onPress={() => openSwitcher(item)}
              >
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
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Pressable
                      onPress={() => remove(item.id)}
                      hitSlop={8}
                      style={styles.removeButton}
                    >
                      <Ionicons
                        name="close"
                        size={16}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    Pokémon • {item.set} • {item.number}
                  </Text>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Price</Text>
                    <Text style={styles.detailValue}>
                      ${item.marketPrice.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Condition</Text>
                    <Pressable
                      onPress={() =>
                        updateCondition(item.id, nextCondition(item.condition))
                      }
                    >
                      <Text style={styles.detailAccent}>
                        {CONDITION_LABELS[item.condition]}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Quantity</Text>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                        style={styles.stepButton}
                        hitSlop={6}
                      >
                        <Ionicons
                          name="remove"
                          size={14}
                          color={colors.text}
                        />
                      </Pressable>
                      <Text style={styles.qtyValue}>{item.quantity}</Text>
                      <Pressable
                        onPress={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                        style={styles.stepButton}
                        hitSlop={6}
                      >
                        <Ionicons name="add" size={14} color={colors.text} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>

          <View
            style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}
          >
            <Text style={styles.totalText}>
              Total: ${totalPrice().toFixed(2)}
            </Text>
            <Text style={styles.countText}>
              {totalCount()} matched scan{totalCount() === 1 ? '' : 's'}.
            </Text>
            <Pressable onPress={handleAdd} style={styles.addButton}>
              <Text style={styles.addButtonText}>Add to Inventory</Text>
            </Pressable>
          </View>
        </>
      )}

      <Modal
        visible={switchItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitchItem(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSwitchItem(null)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle} numberOfLines={1}>
              Switch variant{switchItem ? ` — ${switchItem.name}` : ''}
            </Text>
            {switchLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : switchOptions.length === 0 ? (
              <Text style={styles.modalEmpty}>
                No other variants in the catalog.
              </Text>
            ) : (
              <ScrollView
                style={styles.modalList}
                showsVerticalScrollIndicator={false}
              >
                {switchOptions.map((c) => {
                  const selected = c.productId === switchItem?.productId;
                  return (
                    <Pressable
                      key={c.productId}
                      style={[
                        styles.modalRow,
                        selected && styles.modalRowSelected,
                      ]}
                      onPress={() => {
                        if (switchItem) replaceCard(switchItem.id, c);
                        setSwitchItem(null);
                      }}
                    >
                      {c.imageUrl ? (
                        <Image
                          source={{ uri: c.imageUrl }}
                          style={styles.modalThumb}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <View
                          style={[
                            styles.modalThumb,
                            styles.modalThumbPlaceholder,
                          ]}
                        />
                      )}
                      <View style={styles.modalInfo}>
                        <Text style={styles.modalName} numberOfLines={1}>
                          {c.name} · {c.number}
                        </Text>
                        <Text style={styles.modalMeta} numberOfLines={1}>
                          {c.set}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color="#2dd4bf"
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 48,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  card: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 10,
  },
  image: {
    width: 96,
    height: 132,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  imagePlaceholder: {
    width: 96,
    height: 132,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  cardBody: {
    flex: 1,
    marginLeft: 14,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    marginLeft: 8,
    padding: 2,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  detailValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  detailAccent: {
    color: '#2dd4bf',
    fontSize: 13,
    fontWeight: 'bold',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
    minWidth: 16,
    textAlign: 'center',
  },
  footer: {
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  totalText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  addButton: {
    marginTop: 10,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    backgroundColor: '#2dd4bf',
  },
  addButtonText: {
    color: '#0e1117',
    fontSize: 17,
    fontWeight: 'bold',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: 16,
    backgroundColor: '#10151c',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalList: {
    flexGrow: 0,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalRowSelected: {
    borderColor: '#2dd4bf',
  },
  modalThumb: {
    width: 40,
    height: 56,
    borderRadius: 4,
  },
  modalThumbPlaceholder: {
    backgroundColor: colors.surface,
  },
  modalInfo: {
    flex: 1,
    marginLeft: 10,
  },
  modalName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
});
