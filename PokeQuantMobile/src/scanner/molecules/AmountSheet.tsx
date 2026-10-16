// Shared GlassSheet for money inputs in the scan queue: "$" input row
// with decimal pad + autoFocus, ghost/primary footer buttons, keyboard-
// aware scrolling. Used by the per-card offer editor and the whole-queue
// deal total.

import { memo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../constants/colors';
import { AppButton, GlassSheet } from '../../components/ui';

type Props = {
  title: string;
  hint: string;
  /** Optional card-name heading rendered above the hint. */
  heading?: string;
  artUri?: string | null;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  primaryLabel: string;
  secondaryLabel: string;
  onSecondary: () => void;
};

export const AmountSheet = memo(function AmountSheet({
  title,
  hint,
  heading,
  artUri,
  draft,
  onDraftChange,
  onSubmit,
  onClose,
  primaryLabel,
  secondaryLabel,
  onSecondary,
}: Props) {
  return (
    <GlassSheet
      title={title}
      onClose={onClose}
      keyboardAware
      artUri={artUri}
      scrollProps={{
        keyboardDismissMode: 'interactive',
        keyboardShouldPersistTaps: 'handled',
      }}
      footer={
        <View style={styles.offerButtonRow}>
          <AppButton
            title={secondaryLabel}
            variant="ghost"
            onPress={onSecondary}
            style={styles.offerFooterBtn}
          />
          <AppButton title={primaryLabel} onPress={onSubmit} style={styles.offerFooterBtn} />
        </View>
      }
    >
      <>
        {heading ? (
          <Text style={styles.modalTitle} numberOfLines={1}>
            {heading}
          </Text>
        ) : null}
        <Text style={styles.offerHint}>{hint}</Text>
        <View style={styles.offerInputRow}>
          <Text style={styles.offerDollar}>$</Text>
          <TextInput
            style={styles.offerInput}
            value={draft}
            onChangeText={onDraftChange}
            onSubmitEditing={onSubmit}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
        </View>
      </>
    </GlassSheet>
  );
});

const styles = StyleSheet.create({
  modalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  offerHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 12,
  },
  offerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  offerDollar: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 4,
  },
  offerInput: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingVertical: 10,
  },
  offerButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  offerFooterBtn: {
    flex: 1,
  },
});
