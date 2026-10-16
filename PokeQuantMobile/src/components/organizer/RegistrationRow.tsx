import { memo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { displayName } from '../../services/organizerText';
import type { ShowRegistration } from '../../services/showVendorService';
import { organizerStyles as styles } from './organizerStyles';

export const RegistrationRow = memo(function RegistrationRow({
  reg,
  isOwnerSection,
  onApprove,
  onReject,
  onPay,
  onAssign,
  onRemind,
  onRemove,
}: {
  reg: ShowRegistration;
  isOwnerSection: boolean; // approved rows get payment actions
  onApprove: () => void;
  onReject: () => void;
  onPay: () => void;
  onAssign: () => void;
  onRemind: () => void;
  onRemove: () => void;
}) {
  const remaining = Math.max(0, reg.totalDue - reg.paidAmount);
  const paid = reg.totalDue > 0 && remaining <= 0;
  const hasPhone = Boolean(reg.manualPhone);
  return (
    <View style={styles.regCard}>
      <View style={styles.regHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.regName} numberOfLines={1}>
            {displayName(reg)}
            {reg.isManual ? ' · not on the app' : ''}
          </Text>
          <Text style={styles.regSub}>
            {reg.tableNumber ? `Table ${reg.tableNumber}` : 'No table'}
            {reg.totalDue > 0
              ? `  ·  $${reg.paidAmount.toFixed(2)} / $${reg.totalDue.toFixed(2)}`
              : ''}
          </Text>
        </View>
        {isOwnerSection && reg.totalDue > 0 ? (
          <Text style={[styles.paidBadge, paid ? styles.paidYes : styles.paidNo]}>
            {paid ? 'Paid' : `-$${remaining.toFixed(2)}`}
          </Text>
        ) : null}
      </View>
      <View style={styles.regActions}>
        {reg.status === 'pending' ? (
          <>
            <TouchableOpacity style={[styles.miniBtn, styles.approveBtn]} onPress={onApprove}>
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.miniBtn, styles.rejectBtn]} onPress={onReject}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.miniBtn} onPress={onPay}>
              <Ionicons name="cash-outline" size={13} color={colors.success} />
              <Text style={styles.miniBtnText}>Payment</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} onPress={onAssign}>
              <Ionicons name="grid-outline" size={13} color={colors.primary} />
              <Text style={styles.miniBtnText}>Table</Text>
            </TouchableOpacity>
            {remaining > 0 ? (
              <TouchableOpacity style={styles.miniBtn} onPress={onRemind}>
                <Ionicons name="chatbox-outline" size={13} color={colors.warning} />
                <Text style={[styles.miniBtnText, { color: colors.warning }]}>
                  {hasPhone ? 'Remind' : 'Remind…'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.miniBtn} onPress={onRemove}>
              <Ionicons name="close-outline" size={13} color={colors.error} />
              <Text style={[styles.miniBtnText, { color: colors.error }]}>Remove</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
});
