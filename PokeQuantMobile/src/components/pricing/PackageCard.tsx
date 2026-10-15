// One purchasable plan card in the paywall grid: offering badge, title,
// price/period, and a Select / Current plan / Locked CTA.

import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../constants/colors';
import { FOUNDER_OFFERING_ID } from '../../constants/revenuecat';
import { getOfferingLabel } from './planData';

type Props = {
  title: string;
  price: string;
  period: string;
  offering: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

export const PackageCard = memo(function PackageCard({
  title,
  price,
  period,
  offering,
  selected,
  disabled,
  onPress,
}: Props) {
  const isFounder = offering === FOUNDER_OFFERING_ID;
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.packageCard,
        selected && styles.packageCardSelected,
        disabled && styles.packageCardDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${price} ${period}`}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}>
      <View style={styles.packageBadgeRow}>
        <View
          style={[
            styles.packageBadge,
            isFounder && styles.packageBadgeFounder,
          ]}>
          <Text
            style={[
              styles.packageBadgeText,
              isFounder && styles.packageBadgeTextFounder,
            ]}>
            {getOfferingLabel(offering)}
          </Text>
        </View>
      </View>
      <Text style={styles.packageTitle} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.packagePriceRow}>
        <Text style={styles.packagePrice}>{price}</Text>
        <Text style={styles.packagePeriod}>{period}</Text>
      </View>
      <View
        style={[
          styles.packageCtaBox,
          (disabled || selected) && styles.packageCtaBoxDisabled,
        ]}>
        <Text
          style={[
            styles.packageCta,
            disabled && styles.packageCtaDisabled,
            selected && styles.packageCtaSelected,
          ]}>
          {selected ? 'Current plan' : disabled ? 'Locked' : 'Select'}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  packageCard: {
    width: 160,
    backgroundColor: colors.overlay2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 10,
  },
  packageCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.proTint,
  },
  packageCardDisabled: {
    opacity: 0.55,
  },
  packageBadgeRow: {
    marginBottom: 4,
  },
  packageBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.overlay3,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  packageBadgeFounder: {
    backgroundColor: colors.proTintStrong,
    borderColor: colors.primary,
  },
  packageBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  packageBadgeTextFounder: {
    color: colors.primary,
  },
  packageTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  packagePriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
    marginBottom: 8,
  },
  packagePrice: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  packagePeriod: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: 3,
  },
  packageCtaBox: {
    marginTop: 'auto',
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  packageCtaBoxDisabled: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  packageCta: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  packageCtaDisabled: {
    color: colors.textMuted,
  },
  packageCtaSelected: {
    color: colors.textMuted,
  },
});
