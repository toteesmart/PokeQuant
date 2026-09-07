import { memo, useCallback, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { NumericStepper } from './NumericStepper';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { useShowVendorStore } from '../store/showVendorStore';
import type { ShowListingItem } from '../services/showVendorService';

const THUMB_HEIGHT = 80;
const THUMB_WIDTH = 58;

type Props = {
  showId: string;
  item: ShowListingItem;
};

export const ShowVendorListingRow = memo(function ShowVendorListingRow({
  showId,
  item,
}: Props) {
  const imageUrl = useMemo(
    () => getCatalogImageUri(item.productId),
    [item.productId]
  );
  const [imageError, setImageError] = useRecyclingState(false, [imageUrl]);
  const [isEditing, setIsEditing] = useRecyclingState(false, [item.id]);
  const [draft, setDraft] = useRecyclingState(
    {
      stickerPrice: item.stickerPrice,
      quantity: item.quantity,
      vendorTable: item.vendorTable,
    },
    [item.id]
  );

  const updateListing = useShowVendorStore((state) => state.updateListing);
  const deleteListing = useShowVendorStore((state) => state.deleteListing);

  const meta = [item.number, item.set, item.rarity, item.condition]
    .filter(Boolean)
    .join(' · ');

  const handleUpdate = useCallback(async () => {
    try {
      await updateListing(showId, item.id, {
        stickerPrice: draft.stickerPrice,
        quantity: draft.quantity,
        vendorTable: draft.vendorTable,
      });
      setIsEditing(false);
    } catch (err) {
      Alert.alert(
        'Update failed',
        err instanceof Error ? err.message : 'Could not update this listing.'
      );
    }
  }, [showId, item.id, draft, updateListing, setIsEditing]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete listing',
      `Remove "${item.name}" from the show?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteListing(showId, item.id);
            } catch (err) {
              Alert.alert(
                'Delete failed',
                err instanceof Error ? err.message : 'Could not delete this listing.'
              );
            }
          },
        },
      ]
    );
  }, [showId, item.id, item.name, deleteListing]);

  return (
    <View style={styles.row}>
      {item.imageUrl && !imageError ? (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.thumb}
          resizeMode="contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <View style={[styles.thumb, styles.fallbackThumb]}>
          <Ionicons name="image-outline" size={24} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
        <Text style={styles.vendor} numberOfLines={1}>
          {item.vendorName}
          {item.vendorName && item.vendorTable ? ` · ` : ''}
          {item.vendorTable}
        </Text>

        {isEditing ? (
          <View style={styles.editPanel}>
            <View style={styles.inputsRow}>
              <View style={styles.stepper}>
                <NumericStepper
                  label="Qty"
                  value={draft.quantity}
                  step={1}
                  min={0}
                  decimalPlaces={0}
                  onChange={(value) => setDraft((d) => ({ ...d, quantity: value }))}
                />
              </View>
              <View style={styles.stepper}>
                <NumericStepper
                  label="Price"
                  value={draft.stickerPrice}
                  step={0.25}
                  min={0}
                  decimalPlaces={2}
                  onChange={(value) =>
                    setDraft((d) => ({ ...d, stickerPrice: value }))
                  }
                />
              </View>
            </View>
            <TextInput
              style={styles.tableInput}
              placeholder="Table"
              placeholderTextColor={colors.textMuted}
              value={draft.vendorTable}
              onChangeText={(text) =>
                setDraft((d) => ({ ...d, vendorTable: text }))
              }
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleUpdate}
                style={[styles.button, styles.updateButton]}>
                <Text style={styles.updateText}>Update</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsEditing(false)}
                style={[styles.button, styles.cancelButton]}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleDelete}
                style={[styles.button, styles.deleteButton]}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.readOnly}>
            <Text style={styles.qty}>Qty: {item.quantity}</Text>
            <Text style={styles.price}>${item.stickerPrice.toFixed(2)}</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setIsEditing(true)}
              style={styles.editButton}>
              <Text style={styles.editText}>Edit</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
    minHeight: 110,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  fallbackThumb: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  name: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  vendor: {
    color: colors.primary,
    fontSize: 11,
    marginTop: 2,
  },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  qty: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  price: {
    color: colors.success,
    fontSize: 14,
    fontWeight: 'bold',
  },
  editButton: {
    marginLeft: 'auto',
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  editPanel: {
    marginTop: 10,
    gap: 10,
  },
  inputsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stepper: {
    flex: 1,
  },
  tableInput: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: colors.success,
  },
  updateText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteText: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
});
