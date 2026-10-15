// Show list card for EventListScreen: name/date/location plus the
// access-dependent action row (browse/report/request/pending).

import { memo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../constants/colors';
import { layout, radius } from '../../constants/theme';
import type { ShowItem } from '../../services/ShowListService';

type Props = {
  show: ShowItem;
  isReportable: boolean;
  requestStatus?: string;
  onBrowse: () => void;
  onReport: () => void;
  onRequest: () => void;
  width: number;
};

export const ShowCard = memo(function ShowCard({
  show,
  isReportable,
  requestStatus,
  onBrowse,
  onReport,
  onRequest,
  width,
}: Props) {
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.name} numberOfLines={2}>
          {show.name}
        </Text>
        <Text style={styles.date}>{show.startDate}</Text>
      </View>
      <Text style={styles.location} numberOfLines={2}>
        {show.location}
      </Text>

      <View style={styles.actions}>
        {isReportable ? (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse listings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onReport}
              style={[styles.actionButton, styles.actionReport]}>
              <Ionicons name="add-circle-outline" size={14} color={colors.success} />
              <Text style={[styles.actionText, styles.reportText]}>List your cards</Text>
            </TouchableOpacity>
          </>
        ) : requestStatus === 'pending' ? (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse listings</Text>
            </TouchableOpacity>
            <View style={[styles.actionButton, styles.actionPending]}>
              <Ionicons name="time-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.actionText, styles.pendingText]}>
                Request pending
              </Text>
            </View>
          </>
        ) : requestStatus === 'rejected' ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onBrowse}
            style={[styles.actionButton, styles.actionBrowse, styles.actionFull]}>
            <Text style={styles.browse}>Browse listings</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onBrowse}
              style={[styles.actionButton, styles.actionBrowse]}>
              <Ionicons name="search-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Browse listings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={onRequest}
              style={[styles.actionButton, styles.actionRequest]}>
              <Ionicons name="hand-right-outline" size={14} color={colors.warning} />
              <Text style={[styles.actionText, styles.requestText]}>
                Request a table
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.overlay2,
    borderRadius: radius.cardLg,
    padding: layout.cardPadding,
  },
  cardHeader: {
    marginBottom: 8,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  date: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  location: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionFull: {
    flex: 1,
  },
  actionBrowse: {
    flex: 1,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionReport: {
    flex: 1,
    backgroundColor: colors.successTint,
    borderWidth: 1,
    borderColor: colors.success,
  },
  actionPending: {
    flex: 1,
    backgroundColor: colors.overlay4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pendingText: {
    color: colors.textMuted,
  },
  actionRequest: {
    flex: 1,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  requestText: {
    color: colors.warning,
  },
  browse: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  reportText: {
    color: colors.success,
  },
});
