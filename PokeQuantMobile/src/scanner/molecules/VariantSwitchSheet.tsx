// "Switch variant" sheet for the scan queue: print-finish chips (same
// product, different sub_type) above variant printings (same card name,
// different productIds). Both resolve through the queue store in the hook.

import { memo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { GlassSheet } from '../../components/ui';
import { resolveCardImageUri } from '../services/catalog/ScannerCatalogProvider';
import { displayCardName } from '../services/catalog/catalogMatcher';
import { SetBadge } from '../../components/SetBadge';
import type { CardSignal } from '../../db/catalogDb';
import type { ScannedCard } from '../types/scan';
import type { ScanCatalogCard } from '../types/catalog';

export type FinishOption = {
  subType: string;
  marketPrice: number;
  signal?: CardSignal;
};

type Props = {
  item: ScannedCard;
  loading: boolean;
  finishOptions: FinishOption[];
  switchOptions: ScanCatalogCard[];
  onPickFinish: (option: FinishOption) => void;
  onPickVariant: (card: ScanCatalogCard) => void;
  onClose: () => void;
};

export const VariantSwitchSheet = memo(function VariantSwitchSheet({
  item,
  loading,
  finishOptions,
  switchOptions,
  onPickFinish,
  onPickVariant,
  onClose,
}: Props) {
  return (
    <GlassSheet
      title="Switch variant"
      onClose={onClose}
      artUri={item.imageUrl || null}
    >
      <>
        <Text style={styles.modalTitle} numberOfLines={1}>
          {displayCardName(item.name)}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            {finishOptions.length > 1 ? (
              <>
                <Text style={styles.modalSectionLabel}>
                  Print finish — same card
                </Text>
                <View style={styles.finishRow}>
                  {finishOptions.map((f) => {
                    const selected = f.subType === item.subType;
                    return (
                      <Pressable
                        key={f.subType}
                        style={[
                          styles.finishChip,
                          selected && styles.finishChipSelected,
                        ]}
                        onPress={() => {
                          onPickFinish(f);
                          onClose();
                        }}
                      >
                        <Text
                          style={styles.finishChipText}
                          numberOfLines={1}
                        >
                          {f.subType}
                        </Text>
                        <Text style={styles.finishChipPrice}>
                          ${f.marketPrice.toFixed(2)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            {switchOptions.length === 0 ? (
              <Text style={styles.modalEmpty}>
                No other versions in the price list.
              </Text>
            ) : (
              switchOptions.map((c) => {
              const selected = c.productId === item.productId;
              return (
                <Pressable
                  key={c.productId}
                  style={[
                    styles.modalRow,
                    selected && styles.modalRowSelected,
                  ]}
                  onPress={() => {
                    onPickVariant(c);
                    onClose();
                  }}
                >
                  {resolveCardImageUri(c) ? (
                    <Image
                      source={{ uri: resolveCardImageUri(c) }}
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
                    <SetBadge set={c.set} style={styles.modalSetBadge} />
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })
            )}
          </>
        )}
      </>
    </GlassSheet>
  );
});

const styles = StyleSheet.create({
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.overlay2,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modalRowSelected: {
    borderColor: colors.primary,
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
    fontWeight: '700',
  },
  modalSetBadge: {
    marginTop: 4,
  },
  modalSectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 8,
  },
  finishRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  finishChip: {
    minWidth: 96,
    minHeight: 46,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.overlay3,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  finishChipSelected: {
    borderColor: colors.primary,
  },
  finishChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  finishChipPrice: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
