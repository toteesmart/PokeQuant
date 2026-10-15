// TradeEvaluatorSheet — composition shell. Entry helpers live in
// services/deal/tradeEntry, formatting in utils/format, both side-picker
// pipelines + the many-vs-one guard in hooks/useTradeEntryOps, and the
// sections in molecules/Trade* (all sharing tradeSheetStyles).
import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { colors } from '../../constants/colors';
import { useInventoryStore } from '../../store/inventoryStore';
import { DealAnalysisSheet } from './DealAnalysisSheet';
import {
  evaluateTrade,
  type TradeEntry,
  type TradeVerdict,
} from '../services/deal/tradeEval';
import { completeTrade } from '../services/deal/tradeComplete';
import {
  parseTradeCash,
  tradeEntryMatch,
} from '../services/deal/tradeEntry';
import { useTradeEntryOps } from '../../hooks/useTradeEntryOps';
import { AppButton, GlassSheet } from '../../components/ui';
import { TradeMatchupHeader } from './TradeMatchupHeader';
import { TradeVerdictCard } from './TradeVerdictCard';
import { TradeMathDisclosure } from './TradeMathDisclosure';
import { TradeYourSide } from './TradeYourSide';
import { TradeTheirSide } from './TradeTheirSide';
import { tradeSheetStyles as styles } from './tradeSheetStyles';

type Props = {
  yours: TradeEntry[];
  theirs: TradeEntry[];
  onChangeYours: (entries: TradeEntry[]) => void;
  onChangeTheirs: (entries: TradeEntry[]) => void;
  /** Hand the camera to the user — the next confirmed match lands on
   *  their side. */
  onRequestScan: () => void;
  onClose: () => void;
};

export function TradeEvaluatorSheet({
  yours,
  theirs,
  onChangeYours,
  onChangeTheirs,
  onRequestScan,
  onClose,
}: Props) {
  const inventory = useInventoryStore((s) => s.activeInventory);

  const [analysisFor, setAnalysisFor] = useState<TradeEntry | null>(null);
  const [mathOpen, setMathOpen] = useState(false);
  // Trade terms — the 80%-credit convention plus optional cash top-ups.
  const [tradeRate, setTradeRate] = useState(0.8);
  const [yourCashText, setYourCashText] = useState('');
  const [theirCashText, setTheirCashText] = useState('');

  const {
    yourQuery,
    setYourQuery,
    yourResults,
    theirQuery,
    setTheirQuery,
    theirResults,
    searching,
    limitMsg,
    addYours,
    addTheirs,
    bumpQty,
    removeEntry,
  } = useTradeEntryOps({
    yours,
    theirs,
    onChangeYours,
    onChangeTheirs,
    inventory,
  });

  const verdict: TradeVerdict | null = useMemo(
    () =>
      evaluateTrade(yours, theirs, {
        tradeRate,
        yourCash: parseTradeCash(yourCashText),
        theirCash: parseTradeCash(theirCashText),
      }),
    [yours, theirs, tradeRate, yourCashText, theirCashText]
  );

  const verdictColor =
    verdict?.verdict === 'win'
      ? colors.velocityPositive
      : verdict?.verdict === 'lose'
        ? colors.velocityNegative
        : colors.warning;

  // Glossy backdrop — each side's lead card bleeds into its half of the
  // page, the matchup-poster look from the reference.
  const bgLeft = yours.find((e) => e.imageUrl)?.imageUrl;
  const bgRight = theirs.find((e) => e.imageUrl)?.imageUrl;

  // Complete trade — both sides write for real: outgoing sells at its
  // share of the pot, incoming lands in inventory at carry-over basis.
  const [completing, setCompleting] = useState(false);
  const [completeMsg, setCompleteMsg] = useState<string | null>(null);
  const ctaDisabled =
    completing ||
    !verdict ||
    (yours.length === 0 && parseTradeCash(yourCashText) <= 0) ||
    (theirs.length === 0 && parseTradeCash(theirCashText) <= 0);
  const handleComplete = async () => {
    if (!verdict || completing) return;
    setCompleting(true);
    setCompleteMsg(null);
    try {
      const res = await completeTrade(
        yours,
        theirs,
        verdict,
        parseTradeCash(yourCashText),
        parseTradeCash(theirCashText)
      );
      if (res.ok) {
        onChangeYours([]);
        onChangeTheirs([]);
        onClose();
      } else {
        setCompleteMsg(res.message);
      }
    } catch {
      setCompleteMsg("Couldn't save the trade — nothing was recorded");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <GlassSheet
      title="Check a trade"
      onClose={onClose}
      artUris={[bgLeft, bgRight]}
      keyboardAware
      scrollProps={{
        keyboardShouldPersistTaps: 'handled',
        keyboardDismissMode: 'on-drag',
      }}
      footer={
        <>
          {completeMsg ? (
            <Text style={styles.errorMsg}>{completeMsg}</Text>
          ) : null}
          {/* Pinned CTA — the "Get ticket" slot. Disabled until both
              sides have something real; colored by the verdict like the
              reference's single primary action. */}
          <AppButton
            title="Log this trade"
            onPress={handleComplete}
            color={verdictColor}
            loading={completing}
            disabled={ctaDisabled}
            accessibilityLabel="Log this trade"
            style={styles.completeBtn}
          />
        </>
      }
    >
      {/* Matchup — your stack vs theirs, like the flags header. */}
      <TradeMatchupHeader
        yours={yours}
        theirs={theirs}
        verdict={verdict}
        verdictColor={verdictColor}
      />

      {/* The verdict — the "is this a good trade" answer reads first,
          before the build-up sections. */}
      {verdict && (yours.length > 0 || theirs.length > 0) ? (
        <TradeVerdictCard
          theirs={theirs}
          verdict={verdict}
          verdictColor={verdictColor}
        />
      ) : null}

      {/* The math — a bare disclosure line, not a module; the verdict
          card above is the glanceable answer, this is the receipts for
          anyone who wants them. Plain-language labels, no table jargon. */}
      {verdict ? (
        <TradeMathDisclosure
          verdict={verdict}
          verdictColor={verdictColor}
          expanded={mathOpen}
          onToggle={() => setMathOpen((o) => !o)}
        />
      ) : null}

      {/* They want — picked from your active inventory. Label
          matches the matchup stack so the mapping is glanceable. */}
      <TradeYourSide
        query={yourQuery}
        onQueryChange={setYourQuery}
        results={yourResults}
        onAdd={addYours}
        inventory={inventory}
        entries={yours}
        onQty={(e, d) => bumpQty(yours, onChangeYours)(e.key, d)}
        onRemove={(e) => removeEntry(yours, onChangeYours)(e.key)}
        onOpen={setAnalysisFor}
        effective={verdict?.yourEffective ?? 0}
        cashText={yourCashText}
        onCashChange={setYourCashText}
      />

      <TradeTheirSide
        query={theirQuery}
        onQueryChange={setTheirQuery}
        searching={searching}
        results={theirResults}
        onAdd={addTheirs}
        onRequestScan={onRequestScan}
        entries={theirs}
        onQty={(e, d) => bumpQty(theirs, onChangeTheirs)(e.key, d)}
        onRemove={(e) => removeEntry(theirs, onChangeTheirs)(e.key)}
        onOpen={setAnalysisFor}
        verdict={verdict}
        tradeRate={tradeRate}
        onRateChange={setTradeRate}
        cashText={theirCashText}
        onCashChange={setTheirCashText}
      />

      {limitMsg ? (
        <Text style={styles.limitMsg}>{limitMsg}</Text>
      ) : null}

      {/* Tap any entry for its full timeline + deal read. */}
      {analysisFor ? (
        <DealAnalysisSheet
          match={tradeEntryMatch(analysisFor)}
          subType={analysisFor.subType ?? undefined}
          onClose={() => setAnalysisFor(null)}
        />
      ) : null}
    </GlassSheet>
  );
}
