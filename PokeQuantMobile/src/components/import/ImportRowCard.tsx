// One verification row in the bulk-import wizard — editable fields, the
// match-status pill, and the resolved-catalog panel. Memo'd: the verify
// FlashList recycles these aggressively.

import { memo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { formatCurrency } from '../../utils/format';
import { SetBadge } from '../SetBadge';
import { displayCardName } from '../../scanner/services/catalog/catalogMatcher';
import type { VerificationRow } from './importRows';

type Props = {
  item: VerificationRow;
  index: number;
  onUpdate: (rowId: string, updates: Partial<VerificationRow>) => void;
  onSearch: (rowId: string) => void;
};

export const ImportRowCard = memo(function ImportRowCard({
  item,
  index,
  onUpdate,
  onSearch,
}: Props) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowNumber}>Row {index + 1}</Text>
        {item.isResolving ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : item.matchedCard ? (
          <View style={styles.matchedPill}>
            <Text style={styles.matchedText}>Matched</Text>
          </View>
        ) : (
          <View style={styles.unmatchedPill}>
            <Text style={styles.unmatchedText}>Needs a match</Text>
          </View>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Card Name</Text>
        <TextInput
          style={styles.input}
          value={item.name}
          onChangeText={(text) => onUpdate(item.id, { name: text })}
          placeholder="Searchable card name"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.rowCols}>
        <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
          <Text style={styles.fieldLabel}>Set</Text>
          <TextInput
            style={styles.input}
            value={item.set}
            onChangeText={(text) => onUpdate(item.id, { set: text })}
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Number</Text>
          <TextInput
            style={styles.input}
            value={item.number}
            onChangeText={(text) => onUpdate(item.id, { number: text })}
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <View style={styles.rowCols}>
        <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
          <Text style={styles.fieldLabel}>Condition</Text>
          <TextInput
            style={styles.input}
            value={item.condition}
            onChangeText={(text) =>
              onUpdate(item.id, { condition: text.toUpperCase() })
            }
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
          <Text style={styles.fieldLabel}>Variant</Text>
          <TextInput
            style={styles.input}
            value={item.variant}
            onChangeText={(text) => onUpdate(item.id, { variant: text })}
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      <View style={styles.rowCols}>
        <View style={[styles.field, { flex: 1, marginRight: 6 }]}>
          <Text style={styles.fieldLabel}>You paid ($)</Text>
          <TextInput
            style={styles.input}
            value={item.costBasis}
            onChangeText={(text) => onUpdate(item.id, { costBasis: text })}
            keyboardType="decimal-pad"
            placeholder="Auto"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Sticker ($)</Text>
          <TextInput
            style={styles.input}
            value={item.stickerPrice}
            onChangeText={(text) =>
              onUpdate(item.id, { stickerPrice: text })
            }
            keyboardType="decimal-pad"
            placeholder="Auto"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>

      {!item.isResolving && !item.matchedCard && (
        <TouchableOpacity
          style={styles.searchButton}
          activeOpacity={0.7}
          onPress={() => onSearch(item.id)}>
          <Text style={styles.searchButtonText}>Find this card</Text>
        </TouchableOpacity>
      )}

      {item.matchedCard && (
        <View style={styles.matchPanel}>
          <Text style={styles.matchName} numberOfLines={1}>
            {displayCardName(item.matchedCard.name)}
          </Text>
          <SetBadge set={item.matchedCard.set} style={styles.matchSetBadge} />
          <Text style={styles.matchMeta} numberOfLines={1}>
            {item.matchedCard.number} ·{' '}
            {item.matchedCard.productType || item.matchedCard.rarity}
          </Text>
          <Text style={styles.matchMarket}>
            Market price: {formatCurrency(item.matchedCard.liveMarket)}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  rowCard: {
    backgroundColor: colors.overlay2,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rowNumber: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  matchedPill: {
    backgroundColor: colors.successTintStrong,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  matchedText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  unmatchedPill: {
    backgroundColor: colors.errorTintStrong,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unmatchedText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  rowCols: {
    flexDirection: 'row',
  },
  searchButton: {
    backgroundColor: colors.primaryTint,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  searchButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  matchPanel: {
    backgroundColor: colors.overlay3,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  matchName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  matchSetBadge: {
    marginTop: 4,
  },
  matchMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  matchMarket: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
