// Detail mode — summary strip, unpublish, pending requests, and the
// approved-vendor roster with its per-row action set.
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { layout } from '../../constants/theme';
import { GlassBackButton } from '../ui';
import { RegistrationRow } from './RegistrationRow';
import { organizerStyles as styles } from './organizerStyles';
import { displayName } from '../../services/organizerText';
import type {
  ShowRegistration,
  VendorShow,
} from '../../services/showVendorService';

export function ShowDetailMode({
  selected,
  registrations,
  error,
  onBackToList,
  onEditShow,
  onUnpublish,
  onAddVendor,
  onApprove,
  onReject,
  onPay,
  onAssign,
  onRemind,
}: {
  selected: VendorShow;
  registrations: ShowRegistration[];
  error: string | null;
  onBackToList: () => void;
  onEditShow: (show: VendorShow) => void;
  onUnpublish: () => void;
  onAddVendor: () => void;
  onApprove: (reg: ShowRegistration) => void;
  onReject: (reg: ShowRegistration) => void;
  onPay: (reg: ShowRegistration) => void;
  onAssign: (reg: ShowRegistration) => void;
  onRemind: (reg: ShowRegistration) => void;
}) {
  const insets = useSafeAreaInsets();
  const pending = registrations.filter((r) => r.status === 'pending');
  const approved = registrations.filter((r) => r.status === 'approved');
  const tablesUsed = approved.length;
  const collected = approved.reduce((s, r) => s + r.paidAmount, 0);
  const dueTotal = approved.reduce((s, r) => s + r.totalDue, 0);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + layout.screenTop }]}>
        <GlassBackButton
          onPress={onBackToList}
          label="Back to shows"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {selected.name}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {[selected.start_date, selected.location].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          hitSlop={8}
          accessibilityLabel="Edit show"
          accessibilityRole="button"
          onPress={() => onEditShow(selected)}>
          <Ionicons name="create-outline" size={17} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            {tablesUsed}
            {selected.table_count != null ? `/${selected.table_count}` : ''} tables taken
          </Text>
          <Text style={styles.summaryText}>
            ${collected.toFixed(0)} collected
            {dueTotal > 0 ? ` of $${dueTotal.toFixed(0)} due` : ''}
          </Text>
        </View>

        <TouchableOpacity style={styles.unpublishBtn} onPress={onUnpublish}>
          <Text style={styles.unpublishText}>Unpublish show</Text>
        </TouchableOpacity>

        {pending.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Requests ({pending.length})</Text>
            {pending.map((reg) => (
              <RegistrationRow
                key={reg.vendorId}
                reg={reg}
                isOwnerSection={false}
                onApprove={() => onApprove(reg)}
                onReject={() => onReject(reg)}
                onPay={() => {}}
                onAssign={() => {}}
                onRemind={() => {}}
                onRemove={() => {}}
              />
            ))}
          </>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Vendors ({approved.length})</Text>
          <TouchableOpacity style={styles.addVendorBtn} onPress={onAddVendor}>
            <Ionicons name="person-add-outline" size={13} color={colors.primary} />
            <Text style={styles.addVendorText}>Add</Text>
          </TouchableOpacity>
        </View>

        {approved.length === 0 ? (
          <Text style={styles.emptyText}>No vendors attached yet.</Text>
        ) : (
          approved.map((reg) => (
            <RegistrationRow
              key={reg.vendorId}
              reg={reg}
              isOwnerSection
              onApprove={() => {}}
              onReject={() => {}}
              onPay={() => onPay(reg)}
              onAssign={() => onAssign(reg)}
              onRemind={() => onRemind(reg)}
              onRemove={() =>
                Alert.alert('Remove vendor?', `Remove ${displayName(reg)} from this show?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => onReject(reg),
                  },
                ])
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
