// ScannerCameraView — the live camera + scan pipeline: capture →
// processPhoto → review sheet, with meter gating, trade hand-off, and the
// last-added pill. Chrome lives in molecules/Scanner*; meter plumbing in
// hooks/useScanMeter; trade state in hooks/useTradeScan.
import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraSetup } from '../services/useCameraSetup';
import { CameraPreview } from '../molecules/CameraPreview';
import { MatchReviewSheet } from '../molecules/MatchReviewSheet';
import { DealAnalysisSheet } from '../molecules/DealAnalysisSheet';
import { TradeEvaluatorSheet } from '../molecules/TradeEvaluatorSheet';
import { ScanLimitSheet } from '../molecules/ScanLimitSheet';
import { OcrDebugPanel, type ScanDebugInfo } from './OcrDebugPanel';
import { ScannerTopBar } from '../molecules/ScannerTopBar';
import { ScannerBottomBar } from '../molecules/ScannerBottomBar';
import { WarmingPill, ProcessingOverlay } from '../molecules/ScannerOverlays';
import { CameraPermissionView, CameraInitView } from '../molecules/CameraFallbacks';
import { useScanMeter } from '../../hooks/useScanMeter';
import { useTradeScan } from '../../hooks/useTradeScan';
import { useScanQueueStore } from '../store/scanQueueStore';
import {
  matchForCardRef,
  hydrateVariantPrices,
  resolveCardImageUri,
} from '../services/catalog/ScannerCatalogProvider';
import { processPhoto, type VariantOption } from '../services/processPhoto';
import { catalogName } from '../services/catalog/catalogMatcher';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import { scannerScreenStyles as styles } from '../molecules/scannerScreenStyles';
import { createScannedCard, type ConditionCode, type ScannedCard } from '../types/scan';
import { toErrorMessage } from '../../utils/log';

const DEFAULT_AUTO_CONFIRM_CONDITION: ConditionCode = 'NM';
const DEFAULT_AUTO_CONFIRM_QUANTITY = 1;

export function ScannerCameraView({
  embedded,
  active,
  warming,
  onClose,
  onNext,
  onRetryCamera,
}: {
  embedded: boolean;
  active: boolean;
  warming: boolean;
  onClose?: () => void;
  onNext: () => void;
  onRetryCamera: () => void;
}) {
  const insets = useSafeAreaInsets();
  const camera = useCameraSetup();
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [match, setMatch] = useState<CatalogMatch | null>(null);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [otherMatches, setOtherMatches] = useState<CatalogMatch[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<ScannedCard | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<ScanDebugInfo | null>(null);
  // Release the camera sensor when the app backgrounds too.
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === 'active'
  );
  // capturePhoto on a session that hasn't finished starting throws
  // AVFoundation -11800 — gate the shutter on onStarted/onStopped.
  const [sessionRunning, setSessionRunning] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) =>
      setAppActive(state === 'active')
    );
    return () => sub.remove();
  }, []);

  const queueCount = useScanQueueStore((s) =>
    s.items.reduce((n, i) => n + i.quantity, 0)
  );
  const queueTotal = useScanQueueStore((s) =>
    s.items.reduce((n, i) => n + i.totalPrice, 0)
  );

  const {
    unlimited,
    scansLeft,
    trialDaysLeft,
    limitSheetOpen,
    setLimitSheetOpen,
    canScanToday,
    recordScan,
  } = useScanMeter();

  const [analysis, setAnalysis] = useState<{
    match: CatalogMatch;
    subType?: string;
  } | null>(null);

  const reviewing = cropUri !== null;
  const busy = isCapturing || isCropping;

  const {
    tradeOpen,
    setTradeOpen,
    tradeYours,
    setTradeYours,
    tradeTheirs,
    setTradeTheirs,
    tradeScanPending,
    setTradeScanPending,
    handleTradeScanRequest,
  } = useTradeScan();

  const handleResetScan = useCallback(() => {
    setCropUri(null);
    setMatch(null);
    setVariantOptions([]);
    setOtherMatches([]);
    setError(null);
    // Bailing on a trade scan returns to the sheet rather than dropping
    // the user on the bare camera with their half-built trade gone.
    if (tradeScanPending) {
      setTradeScanPending(false);
      setTradeOpen(true);
    }
  }, [tradeScanPending, setTradeScanPending, setTradeOpen]);

  const handleSelectMatch = useCallback((selected: CatalogMatch) => {
    console.log(
      'ScannerScreen: selected match',
      selected.card.name,
      selected.confidence.toFixed(3)
    );
    setMatch(selected);
    // User-picked alternates may carry no hydrated price — resolve lazily and
    // bump state once variants populate so the sheet stops showing $0.00.
    hydrateVariantPrices([selected.card])
      .then(() => setMatch((m) => (m ? { ...m } : m)))
      .catch((e) => console.warn('ScannerScreen: price hydrate failed', e));
  }, []);

  const handleConfirm = useCallback(
    (condition: ConditionCode, quantity: number, subType?: string) => {
      if (!match?.card) return;
      const item = createScannedCard(match.card, condition, quantity, subType);
      useScanQueueStore.getState().add(item);
      setLastAdded(item);
      handleResetScan();
    },
    [match, handleResetScan]
  );

  // Scan-to-trade: the matched card lands on the customer's side of the
  // evaluator with its price + engine signal already attached.
  const handleTradeAdd = useCallback(
    (quantity: number, subType?: string) => {
      if (!match?.card) return;
      const variant =
        match.card.variants.find((v) => v.subType === subType) ??
        match.card.variants[0];
      setTradeTheirs((prev) => [
        ...prev,
        {
          key: `scan-${Date.now()}`,
          productId: match.card.productId,
          subType: variant?.subType ?? null,
          name: catalogName(match.card),
          number: match.card.number,
          set: match.card.set,
          imageUrl: resolveCardImageUri(match.card) ?? undefined,
          qty: quantity,
          price: variant?.marketPrice ?? 0,
          signal: variant?.signal,
          variants: match.card.variants,
        },
      ]);
      setTradeScanPending(false);
      handleResetScan();
      setTradeOpen(true);
    },
    [match, handleResetScan, setTradeTheirs, setTradeScanPending, setTradeOpen]
  );

  // The auto-confirm pill: tapping the last-scanned card opens its deal
  // analysis with every finish hydrated — the queue stays on Next.
  const openAnalysisForScanned = useCallback((card: ScannedCard) => {
    void matchForCardRef({ ...card, marketPrice: card.baseMarketPrice })
      .then((m) => setAnalysis({ match: m, subType: card.subType }))
      .catch(() => {});
  }, []);

  const handleShutter = useCallback(async () => {
    if (!camera.ready || !sessionRunning || isCapturing || isCropping) {
      console.log('ScannerScreen: shutter ignored', {
        ready: camera.ready,
        sessionRunning,
        isCapturing,
        isCropping,
      });
      return;
    }
    if (!canScanToday()) {
      setLimitSheetOpen(true);
      return;
    }
    setIsCapturing(true);
    setError(null);

    try {
      const captureStart = Date.now();
      console.log('ScannerScreen: capture start');
      // If the camera session is wedged the capture promise never settles —
      // race a timeout so `busy` clears and the user can retry.
      const photo = await Promise.race([
        camera.takePhoto(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Camera timed out — try again')),
            15000
          )
        ),
      ]);
      console.log('ScannerScreen: capture done in', Date.now() - captureStart, 'ms', photo.width, photo.height);
      setIsCapturing(false);
      setIsCropping(true);

      const processStart = Date.now();
      console.log('ScannerScreen: process start');
      const crop = await processPhoto(photo);
      // Only successful processing consumes a scan — a failed capture or a
      // pipeline error never burns one of the day's free scans.
      recordScan();
      console.log('ScannerScreen: process done in', Date.now() - processStart, 'ms', crop.uri);

      setDebugInfo({
        cropConfidence: crop.detection?.confidence ?? null,
        usedGuideFallback: crop.usedGuideFallback,
        topText: crop.ocr?.topText ?? '',
        bottomText: crop.ocr?.bottomText ?? '',
        numberText: crop.ocr?.numberText ?? null,
        method: crop.match?.method ?? null,
        confidence: crop.fusion.top?.confidence ?? null,
        autoConfirm: crop.fusion.autoConfirm,
      });
      setCropUri(crop.uri);
      setMatch(crop.match);
      setVariantOptions(crop.variantOptions);
      setOtherMatches(crop.otherMatches);
      console.log(
        'ScannerScreen: state set',
        'autoConfirm',
        crop.fusion.autoConfirm
      );

      if (crop.fusion.autoConfirm && crop.fusion.top?.card) {
        const item = createScannedCard(
          crop.fusion.top.card,
          DEFAULT_AUTO_CONFIRM_CONDITION,
          DEFAULT_AUTO_CONFIRM_QUANTITY
        );
        useScanQueueStore.getState().add(item);
        setLastAdded(item);
        handleResetScan();
      }
    } catch (e) {
      console.error('ScannerScreen: error', e);
      setError(toErrorMessage(e));
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera, sessionRunning, isCapturing, isCropping, handleResetScan, canScanToday, recordScan, setLimitSheetOpen]);

  if (!camera.hasPermission) {
    return (
      <CameraPermissionView
        canRequestPermission={camera.canRequestPermission}
        onRequestPermission={camera.requestPermission}
        onRetryCamera={onRetryCamera}
        onClose={onClose}
      />
    );
  }

  if (!camera.ready) {
    return <CameraInitView onRetryCamera={onRetryCamera} />;
  }

  return (
    <View style={styles.container}>
      <CameraPreview
        device={camera.device}
        photoOutput={camera.photoOutput}
        isActive={active && appActive}
        onStarted={() => setSessionRunning(true)}
        onStopped={() => setSessionRunning(false)}
        onError={(e) => setError(toErrorMessage(e))}
      />

      {/* Top bar */}
      <ScannerTopBar
        topPad={insets.top + 6}
        showBack={!embedded && !!onClose}
        onClose={onClose}
        showMeter={!unlimited && !reviewing}
        trialDaysLeft={trialDaysLeft}
        scansLeft={scansLeft}
        showTrade={!reviewing}
        onTrade={() => setTradeOpen(true)}
        onToggleDebug={() => setDebugOpen((v) => !v)}
      />

      {/* Matcher warm-up banner — scanning still works, the first one just
          joins the in-flight load. Non-interactive so it can't eat taps. */}
      {warming ? <WarmingPill top={insets.top + 52} /> : null}

      {/* Hint / last-added tray + bottom controls */}
      {!reviewing ? (
        <ScannerBottomBar
          bottomPad={insets.bottom + 4}
          busy={busy}
          lastAdded={lastAdded}
          onOpenAnalysis={openAnalysisForScanned}
          sessionRunning={sessionRunning}
          error={error}
          queueCount={queueCount}
          queueTotal={queueTotal}
          onShutter={handleShutter}
          onNext={onNext}
        />
      ) : null}

      {/* Processing indicator — without this a multi-second first scan reads
          as a frozen app. */}
      {busy ? <ProcessingOverlay isCropping={isCropping} /> : null}

      {/* Match review sheet */}
      {cropUri ? (
        <MatchReviewSheet
          uri={cropUri}
          match={match}
          variantOptions={variantOptions}
          otherMatches={otherMatches}
          onRetake={handleResetScan}
          onConfirm={handleConfirm}
          onSelectMatch={handleSelectMatch}
          onAnalyze={(subType) =>
            match ? setAnalysis({ match, subType }) : null
          }
          tradePending={tradeScanPending}
          onTradeAdd={handleTradeAdd}
        />
      ) : null}

      {/* Deep-dive price analysis — overlays the review sheet, returns
          to it on close so the scan stays in context. */}
      {analysis ? (
        <DealAnalysisSheet
          match={analysis.match}
          subType={analysis.subType}
          onClose={() => setAnalysis(null)}
        />
      ) : null}

      {/* Two-sided trade evaluator — "they want X, they offer Y" fairness. */}
      {tradeOpen ? (
        <TradeEvaluatorSheet
          yours={tradeYours}
          theirs={tradeTheirs}
          onChangeYours={setTradeYours}
          onChangeTheirs={setTradeTheirs}
          onRequestScan={handleTradeScanRequest}
          onClose={() => setTradeOpen(false)}
        />
      ) : null}

      {/* Debug overlay */}
      {debugOpen ? (
        <OcrDebugPanel top={insets.top + 52} info={debugInfo} />
      ) : null}

      {/* Daily-limit upgrade sheet — hard block: dismissing keeps the
          shutter gated; every press re-opens it until midnight or upgrade. */}
      <ScanLimitSheet
        visible={limitSheetOpen}
        onClose={() => setLimitSheetOpen(false)}
        onUpgraded={() => setLimitSheetOpen(false)}
      />
    </View>
  );
}
