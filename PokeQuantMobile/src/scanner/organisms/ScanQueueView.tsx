import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { CircleButton } from '../../components/ui';
import { DealAnalysisSheet } from '../molecules/DealAnalysisSheet';
import { CardImageViewer } from '../../components/CardImageViewer';
import { ScanQueueRow } from '../molecules/ScanQueueRow';
import { VariantSwitchSheet } from '../molecules/VariantSwitchSheet';
import { AmountSheet } from '../molecules/AmountSheet';
import { useScanQueue } from '../hooks/useScanQueue';

type Props = {
  onBack?: () => void;
  onDone?: () => void;
};

export function ScanQueueView({ onBack, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const q = useScanQueue(onDone);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <CircleButton
          icon="arrow-back"
          size={40}
          iconSize={20}
          onPress={() => onBack?.()}
          accessibilityLabel="Back to scanner"
        />
        <Text style={styles.title}>Review your scans</Text>
        <View style={styles.backButton} />
      </View>

      {q.items.length === 0 ? (
        <Text style={styles.empty}>
          No cards yet. Scan one to get started.
        </Text>
      ) : (
        <>
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {q.items.map((item) => (
              <ScanQueueRow
                key={item.id}
                item={item}
                onOpenSwitcher={q.openSwitcher}
                onViewImage={q.openViewer}
                onAnalyze={q.openAnalysis}
                onRemove={q.remove}
                onEditOffer={q.openOfferEdit}
                onCondition={q.updateCondition}
                onQuantity={q.updateQuantity}
              />
            ))}
          </ScrollView>

          <View
            style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}
          >
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalText}>
                  Total: ${q.totalPrice().toFixed(2)}
                </Text>
                <Text style={styles.countText}>
                  {q.totalCount()} card{q.totalCount() === 1 ? '' : 's'} · you pay $
                  {Math.round(q.queueOfferTotal)}
                </Text>
              </View>
              <Pressable
                style={styles.dealButton}
                onPress={q.openDeal}
              >
                <Ionicons
                  name="cash-outline"
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.dealButtonText}>Deal</Text>
              </Pressable>
            </View>
            {q.flushError ? (
              <Text style={styles.flushError}>{q.flushError}</Text>
            ) : null}
            <Pressable
              onPress={q.flush}
              style={[styles.addButton, q.isFlushing && styles.addButtonBusy]}
              disabled={q.isFlushing}
            >
              {q.isFlushing ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={styles.addButtonText}>Add to Inventory</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      {q.switchItem !== null ? (
        <VariantSwitchSheet
          item={q.switchItem}
          loading={q.switchLoading}
          finishOptions={q.finishOptions}
          switchOptions={q.switchOptions}
          onPickFinish={q.pickFinish}
          onPickVariant={q.pickVariant}
          onClose={q.closeSwitcher}
        />
      ) : null}

      {/* Negotiated-offer editor */}
      {q.offerItem != null ? (
        <AmountSheet
          title="Cash offer"
          heading={q.offerItem.name}
          hint="What you’ll pay for this card. Leave blank to use the suggested price."
          artUri={q.offerItem.imageUrl || null}
          draft={q.offerDraft}
          onDraftChange={q.setOfferDraft}
          onSubmit={q.commitOffer}
          onClose={q.closeOffer}
          primaryLabel="Set offer"
          secondaryLabel="Reset to auto"
          onSecondary={q.resetOffer}
        />
      ) : null}

      {/* Whole-queue deal — prorates one negotiated total across cards by
          their current offer share. */}
      {q.dealOpen ? (
        <AmountSheet
          title="Deal total"
          hint={`One price for the whole batch — split across all ${q.items.length} card${q.items.length === 1 ? '' : 's'} in proportion to their offers.`}
          draft={q.dealDraft}
          onDraftChange={q.setDealDraft}
          onSubmit={q.commitDeal}
          onClose={q.closeDeal}
          primaryLabel="Apply to all"
          secondaryLabel="Cancel"
          onSecondary={q.closeDeal}
        />
      ) : null}

      {/* Deep-dive on the card behind a queued row — opens on name tap. */}
      {q.analysisFor ? (
        <DealAnalysisSheet
          match={q.analysisFor.match}
          subType={q.analysisFor.subType}
          onClose={q.closeAnalysis}
        />
      ) : null}

      {q.viewerFor ? (
        <CardImageViewer
          visible
          uri={q.viewerFor.uri}
          name={q.viewerFor.name}
          onClose={q.closeViewer}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 48,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  footer: {
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  totalText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  dealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  dealButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  flushError: {
    color: colors.error,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  addButton: {
    marginTop: 10,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  addButtonBusy: {
    opacity: 0.7,
  },
  addButtonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '700',
  },
});
