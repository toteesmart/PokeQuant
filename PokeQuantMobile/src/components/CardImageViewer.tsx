import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';

const CARD_ASPECT_RATIO = 2.5 / 3.5; // width / height

type Props = {
  visible: boolean;
  uri: string | null | undefined;
  name: string;
  caption?: string;
  onClose: () => void;
};

/**
 * Fullscreen card viewer — tap a card photo anywhere in the app to show it
 * large. Built for the show floor: near-black backdrop, card fills the
 * screen, tap anywhere to dismiss so it can be flashed at a vendor.
 */
export function CardImageViewer({ visible, uri, name, caption, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const maxH = winH - insets.top - insets.bottom - 140;
  const imgWidth = Math.max(1, Math.min(winW - 32, maxH * CARD_ASPECT_RATIO));
  const imgHeight = imgWidth / CARD_ASPECT_RATIO;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View pointerEvents="none" style={styles.center}>
          <View style={[styles.imageWrap, { width: imgWidth, height: imgHeight }]}>
            {uri ? (
              <Image
                source={{ uri }}
                style={{ width: imgWidth, height: imgHeight }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : (
              <Ionicons name="image-outline" size={64} color={colors.textMuted} />
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {caption ? (
            <Text style={styles.caption} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>

        <Pressable
          style={[styles.closeButton, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.text} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 18,
    paddingHorizontal: 24,
  },
  caption: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },
});
