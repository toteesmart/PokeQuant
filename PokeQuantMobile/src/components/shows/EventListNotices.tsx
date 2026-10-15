// The notice strip above the show list: unpaid balances, vendor-side
// errors (inline, never blocking the list), the launch-pricing banner,
// and a degraded-load error shown only when shows are still visible.

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { radius } from '../../constants/theme';
import type { VendorBalance } from '../../services/showVendorService';

type Props = {
  balances: VendorBalance[];
  vendorNotice: string | null;
  showLaunchNotice: boolean;
  error: string | null;
  hasShows: boolean;
};

export const EventListNotices = memo(function EventListNotices({
  balances,
  vendorNotice,
  showLaunchNotice,
  error,
  hasShows,
}: Props) {
  return (
    <>
      {balances.length > 0
        ? balances.slice(0, 2).map((b) => (
            <View key={b.showId} style={styles.balanceBanner}>
              <Ionicons name="cash-outline" size={14} color={colors.warning} />
              <Text style={styles.noticeText}>
                Balance due: ${b.remaining.toFixed(2)} at {b.showName}
                {b.tableNumber ? ` (Table ${b.tableNumber})` : ''}
                {b.organizerName ? ` — pay ${b.organizerName}` : ''}
                {b.payInstructions ? ` · ${b.payInstructions}` : ''}
              </Text>
            </View>
          ))
        : null}
      {balances.length > 2 ? (
        <Text style={[styles.noticeText, { marginHorizontal: 16 }]}>
          +{balances.length - 2} more unpaid show{balances.length - 2 === 1 ? '' : 's'}
        </Text>
      ) : null}

      {vendorNotice ? (
        <View style={styles.noticeWrap}>
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color={colors.warning}
          />
          <Text style={styles.noticeText}>{vendorNotice}</Text>
        </View>
      ) : null}

      {/* Launch-pricing notice — only vendors (anyone with show access) see
          it; attendees browsing the catalog never do. */}
      {showLaunchNotice ? (
        <View style={[styles.noticeWrap, styles.noticeInfo]}>
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={colors.primary}
          />
          <Text style={styles.noticeText}>
            Vendor tools are free during launch — a Pro plan will be required
            after launch pricing ends.
          </Text>
        </View>
      ) : null}

      {error && hasShows ? (
        <View style={styles.noticeWrap}>
          <Ionicons name="warning-outline" size={14} color={colors.warning} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  balanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.controlLg,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.controlLg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeInfo: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
});
