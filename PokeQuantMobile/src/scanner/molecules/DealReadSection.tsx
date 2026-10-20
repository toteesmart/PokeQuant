// DealReadSection — the bottom half of DealAnalysisSheet: class
// headline + shielded offer band + customer script for unowned cards,
// or the owned-position card (cost basis, cushion, floor/target
// triggers) when the caller passes ownership. Strings come from the
// deal engine's copy layer so the coherence harness renders the same
// wording the user sees.
import { Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import type { CardSignal } from '../../db/catalogDb';
import {
  dealAction,
  offerBand,
  ownerNote,
  positionAction,
  resolvePosition,
  resolveRangeEvidence,
  type DealRead,
} from '../services/deal/dealClassify';
import { positionTriggers } from '../services/deal/sheetReads';
import type { SeriesFeatures } from '../services/deal/seriesSignals';
import { useVendorStore } from '../../store/vendorStore';
import { tintBg } from '../../utils/tint';
import { fmtDollars, heldDays, heldLabel } from '../../utils/format';
import { styles } from './dealSheetStyles';

/** Present when the card is already in inventory — flips the deal read
 *  into position language (cost basis, days held, cushion vs cost). */
export type DealOwnership = {
  paid: number;
  since?: string;
  sticker?: number;
};

function PositionSection({
  read,
  signal,
  ownership,
  features,
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership: DealOwnership;
  features?: SeriesFeatures | null;
}) {
  const days = heldDays(ownership.since);
  const mkt = signal?.price ?? 0;
  const vsCost = mkt > 0 ? mkt - ownership.paid : null;
  const cushion = signal?.fwd30dLo != null ? signal.fwd30dLo - ownership.paid : null;
  // The floor/target decision — same pure read the coherence harness
  // renders, so the trigger rows and the tested strings can't drift.
  const { floorPrice, crackPrice, floorCracked, bounceCheap, showFloor, targetPrice, showTarget } =
    positionTriggers(read, signal, features);
  // The context verdict the owned verb quotes — same resolvePosition
  // inputs ownerNote consumes, so "sell if it drops below the floor"
  // can't render while the card sits inside the sell-end band.
  const ctxEv = resolveRangeEvidence(signal, features);
  const ctxPosition = resolvePosition(
    mkt > 0 ? mkt : null,
    floorPrice,
    ctxEv.ceiling ?? targetPrice,
    signal?.targetPrice,
    ctxEv.ath,
  );

  return (
    <View
      style={[
        styles.dealCard,
        {
          borderLeftColor: read.color,
          backgroundColor: tintBg(read.color),
        },
      ]}
    >
      {/* Action first — what to do with this card today. */}
      <Text style={[styles.dealAction, { color: read.color }]}>
        {positionAction(read, {
          cracked: floorCracked,
          bounceCheap,
          ceiling: showTarget ? targetPrice : null,
          // A real-dollar win only — +$0.40 on a $6 card isn't green,
          // it's the same sticker price.
          green: vsCost != null && vsCost >= 1,
          price: mkt,
          position: ctxPosition,
        })}
      </Text>
      {vsCost != null ? (
        <Text style={[styles.positionHero, vsCost >= 0 ? styles.metricUp : styles.metricDown]}>
          {vsCost >= 0 ? 'Up ' : 'Down '}
          {`$${fmtDollars(vsCost)}`} vs your cost
        </Text>
      ) : null}
      <Text style={styles.positionMeta}>
        You paid ${Math.round(ownership.paid)}
        {days != null ? ` · held ${heldLabel(days)}` : ''}
        {mkt > 0 ? ` · worth $${Math.round(mkt)} now` : ''}
      </Text>
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      {
        // Downside under cost only matters when it's real money — 13¢
        // under cost on a $1.27 fodder card isn't a threat, it's the
        // same $1 sticker either way. The drag problem (it sits in
        // inventory forever) is what the owner note carries.
        cushion != null && cushion < -3 ? (
          <Text style={[styles.positionLine, styles.metricDown]}>
            A bad month could take it ~${fmtDollars(cushion)} under your cost
          </Text>
        ) : null
      }
      <Text style={styles.dealScript}>
        {`“${ownerNote(read, features ?? undefined, { price: mkt > 0 ? mkt : null, floor: floorPrice, vsCost, daysHeld: days, cracked: floorCracked, ceiling: targetPrice, signal })}”`}
      </Text>
      {showFloor && floorPrice != null && crackPrice != null ? (
        <View style={styles.triggerRow}>
          <Text style={[styles.triggerTag, { color: read.color }]}>
            {floorCracked ? 'FLOOR BROKE' : 'SELL IF BELOW'}
          </Text>
          <Text style={styles.triggerPrice}>
            ${(floorCracked ? floorPrice : crackPrice).toFixed(2)}
          </Text>
          <Text style={styles.triggerTail}>
            {floorCracked
              ? bounceCheap
                ? 'its floor broke — sell it'
                : 'floor broke — sell when it bounces back'
              : 'if it drops below, expect new lows'}
          </Text>
        </View>
      ) : null}
      {showTarget && targetPrice != null ? (
        <View style={styles.triggerRow}>
          <Text style={[styles.triggerTag, { color: colors.velocityPositive }]}>SELL AT</Text>
          <Text style={styles.triggerPrice}>~${targetPrice.toFixed(2)}</Text>
          <Text style={styles.triggerTail}>bounce target — take the money</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Class headline + shielded offer band + customer script — the
 *  table-time read. The class badge sits in the verdict row above. */
export function DealReadSection({
  read,
  signal,
  ownership,
  features,
}: {
  read: DealRead;
  signal: CardSignal | undefined;
  ownership?: DealOwnership;
  features?: SeriesFeatures | null;
}) {
  const getCashOffer = useVendorStore((s) => s.getCashOffer);
  const mkt = signal?.price ?? 0;
  const base = mkt > 0 ? getCashOffer(mkt) : 0;
  const band = base > 0 ? offerBand(read, base) : null;

  if (ownership) {
    return (
      <PositionSection read={read} signal={signal} ownership={ownership} features={features} />
    );
  }

  return (
    <View
      style={[
        styles.dealCard,
        {
          borderLeftColor: read.color,
          backgroundColor: tintBg(read.color),
        },
      ]}
    >
      {/* Action first — the two-second read. Numbers, then the story. */}
      <Text style={[styles.dealAction, { color: read.color }]}>{dealAction(read)}</Text>
      {band ? (
        <Text style={styles.dealOffer}>
          Offer ${Math.round(band.open)} · don&rsquo;t pass ${Math.round(band.max)}
        </Text>
      ) : null}
      <Text style={styles.dealHeadline}>{read.headline}</Text>
      <Text style={styles.dealScript}>“{read.script}”</Text>
    </View>
  );
}
