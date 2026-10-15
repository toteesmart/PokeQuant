// List mode — owned-show cards with the New Show action; opened through
// openDetail (which also kicks the registration load).
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { layout } from '../../constants/theme';
import { GlassBackButton } from '../ui';
import { organizerStyles as styles } from './organizerStyles';
import type { VendorShow } from '../../services/showVendorService';

export function ShowListMode({
  shows,
  loading,
  error,
  onBack,
  onNewShow,
  onOpenShow,
}: {
  shows: VendorShow[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onNewShow: () => void;
  onOpenShow: (s: VendorShow) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + layout.screenTop }]}>
        <GlassBackButton onPress={onBack} label="Back" />
        <Text style={styles.title}>Organize</Text>
        <TouchableOpacity
          style={styles.newShowBtn}
          onPress={onNewShow}>
          <Ionicons name="add" size={15} color={colors.primary} />
          <Text style={styles.newShowText}>New Show</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : shows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            No shows yet — create one to start managing vendors.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {shows.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.showCard}
              onPress={() => onOpenShow(s)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.showName}>{s.name}</Text>
                <Text style={styles.showSub}>
                  {[s.start_date, s.location].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
