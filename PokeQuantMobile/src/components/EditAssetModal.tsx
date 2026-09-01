import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../constants/colors';
import { AddAssetForm } from './AddAssetForm';
import type { InventoryCard } from '../context/InventoryContext';

type EditAssetModalProps = {
  visible: boolean;
  card: InventoryCard | null;
  onClose: () => void;
};

export function EditAssetModal({
  visible,
  card,
  onClose,
}: EditAssetModalProps) {
  if (!card) return null;

  const imageSource = card.imageUrl
    ? { uri: card.imageUrl }
    : require('../../logo.png');

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Edit Asset</Text>
            <TouchableOpacity
              style={styles.closeButton}
              activeOpacity={0.7}
              onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.imageWrapper}>
            <Image
              source={imageSource}
              style={styles.cardImage}
              resizeMode="contain"
            />
          </View>

          <AddAssetForm
            initialCard={card}
            onComplete={onClose}
            onCancel={onClose}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: '90%',
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: 'bold',
  },
  imageWrapper: {
    alignItems: 'center',
    marginBottom: 12,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 2.5 / 3.5,
    maxHeight: 150,
  },
});
