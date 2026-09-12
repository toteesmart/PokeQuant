import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { useCameraSetup } from '../scanner/services/useCameraSetup';
import { CameraPreview } from '../scanner/molecules/CameraPreview';
import { ShutterButton } from '../scanner/atoms/ShutterButton';
import { MatchReviewSheet } from '../scanner/molecules/MatchReviewSheet';
import { processPhoto, type VariantOption } from '../scanner/services/processPhoto';
import type { CatalogMatch } from '../scanner/services/catalog/catalogMatcher';
import { createScannedCard, type ConditionCode, type ScannedCard } from '../scanner/types/scan';
import { offerBreakdown } from '../scanner/utils/pricing';
import { useScanQueueStore } from '../scanner/store/scanQueueStore';
import { areScannerAssetsReady } from '../scanner/services/ScannerAssetService';
import { loadBinarySidecar } from '../scanner/services/visual/EmbeddingCache';
import { loadScannerCatalog } from '../scanner/services/catalog/ScannerCatalogProvider';
import { warmCardDetectorModel } from '../scanner/services/detection/CardDetector';
import { warmVisualEmbedderModel } from '../scanner/services/visual/VisualEmbedder';
import { ScannerDownloadGate } from '../scanner/organisms/ScannerDownloadGate';
import { ScanQueueView } from '../scanner/organisms/ScanQueueView';
import { OcrDebugPanel, type ScanDebugInfo } from '../scanner/organisms/OcrDebugPanel';

const DEFAULT_AUTO_CONFIRM_CONDITION: ConditionCode = 'NM';
const DEFAULT_AUTO_CONFIRM_QUANTITY = 1;

type Phase = 'checking' | 'gate' | 'ready';

type Props = {
  onClose?: () => void;
  onDone?: () => void;
  embedded?: boolean;
  /** False when the hosting surface is hidden (e.g. unfocused tab) — powers
   * down the camera sensor while the screen stays mounted. */
  active?: boolean;
};

export function ScannerScreen({
  onClose,
  onDone,
  embedded = false,
  active = true,
}: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('checking');
  const [view, setView] = useState<'camera' | 'queue'>('camera');
  // Bump to remount the camera subtree when the device/permission flow gets
  // stuck (e.g. first-run permission grant not propagating).
  const [camEpoch, setCamEpoch] = useState(0);
  const [warming, setWarming] = useState(false);

  // Warm the catalog + embedding sidecar in the background — processPhoto
  // joins the in-flight loads on the first scan, so the camera opens
  // immediately instead of waiting ~20 s behind a spinner.
  const startWarmUp = useCallback(() => {
    setWarming(true);
    void Promise.all([loadScannerCatalog(), loadBinarySidecar()])
      .catch((e) => console.warn('ScannerScreen: warm-up failed', e))
      .finally(() => setWarming(false));
    warmCardDetectorModel();
    warmVisualEmbedderModel();
  }, []);

  // Scanner assets (models + sidecar) must exist before the pipeline can run.
  // Missing assets route to the download gate — ~140 MB, so the user sees the
  // explicit download UI with progress + cancel rather than a silent fetch.
  useEffect(() => {
    let cancelled = false;
    areScannerAssetsReady()
      .then((ready) => {
        if (cancelled) return;
        if (ready) {
          startWarmUp();
          setPhase('ready');
        } else {
          setPhase('gate');
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('gate');
      });
    return () => {
      cancelled = true;
    };
  }, [startWarmUp]);

  const handleDone = useCallback(() => {
    if (onDone) {
      onDone();
    } else {
      setView('camera');
    }
  }, [onDone]);

  if (phase === 'gate') {
    return (
      <ScannerDownloadGate
        onReady={() => {
          startWarmUp();
          setPhase('ready');
        }}
        onCancel={onClose ?? (() => {})}
      />
    );
  }

  if (phase !== 'ready') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.text}>Checking scanner assets...</Text>
      </View>
    );
  }

  if (view === 'queue') {
    return (
      <ScanQueueView
        onBack={() => setView('camera')}
        onDone={handleDone}
      />
    );
  }

  return (
    <ScannerCameraView
      key={camEpoch}
      embedded={embedded}
      active={active}
      warming={warming}
      onClose={onClose}
      onNext={() => setView('queue')}
      onRetryCamera={() => setCamEpoch((e) => e + 1)}
    />
  );
}

function ScannerCameraView({
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

  const reviewing = cropUri !== null;
  const busy = isCapturing || isCropping;

  const handleResetScan = useCallback(() => {
    setCropUri(null);
    setMatch(null);
    setVariantOptions([]);
    setOtherMatches([]);
    setError(null);
  }, []);

  const handleSelectMatch = useCallback((selected: CatalogMatch) => {
    console.log(
      'ScannerScreen: selected match',
      selected.card.name,
      selected.confidence.toFixed(3)
    );
    setMatch(selected);
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
    setIsCapturing(true);
    setError(null);

    try {
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
      console.log('ScannerScreen: capture done', photo.width, photo.height);
      setIsCapturing(false);
      setIsCropping(true);

      console.log('ScannerScreen: process start');
      const crop = await processPhoto(photo);
      console.log('ScannerScreen: process done', crop.uri);

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
      setError(e instanceof Error ? e.message : 'Failed to process photo');
    } finally {
      setIsCapturing(false);
      setIsCropping(false);
    }
  }, [camera, sessionRunning, isCapturing, isCropping, handleResetScan]);

  if (!camera.hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.text}>Camera permission is required.</Text>
        {camera.canRequestPermission ? (
          <Pressable onPress={camera.requestPermission} style={styles.button}>
            <Text style={styles.buttonText}>Grant permission</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => Linking.openSettings()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable
          onPress={onRetryCamera}
          style={[styles.button, styles.buttonSecondary]}
        >
          <Text style={styles.buttonSecondaryText}>Retry</Text>
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} style={[styles.button, styles.buttonSecondary]}>
            <Text style={styles.buttonSecondaryText}>Back</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (!camera.ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.text}>Initializing camera...</Text>
        <Pressable
          onPress={onRetryCamera}
          style={[styles.button, styles.buttonSecondary]}
        >
          <Text style={styles.buttonSecondaryText}>
            Tap if camera doesn't start
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraPreview
        device={camera.device}
        photoOutput={camera.photoOutput}
        isActive={active && appActive}
        onStarted={() => setSessionRunning(true)}
        onStopped={() => setSessionRunning(false)}
        onError={(e) => setError(e.message)}
      />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        {!embedded && onClose ? (
          <Pressable onPress={onClose} hitSlop={12} style={styles.topIcon}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.topIcon} />
        )}
        <Text style={styles.topTitle}>Pokémon</Text>
        <Pressable
          onPress={() => setDebugOpen((v) => !v)}
          hitSlop={12}
          style={styles.topIcon}
        >
          <Ionicons name="settings-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Matcher warm-up banner — scanning still works, the first one just
          joins the in-flight load. Non-interactive so it can't eat taps. */}
      {warming ? (
        <View
          style={[styles.warmingPill, { top: insets.top + 52 }]}
          pointerEvents="none"
        >
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.warmingText}>Preparing matcher…</Text>
        </View>
      ) : null}

      {/* Hint / last-added tray + bottom controls */}
      {!reviewing ? (
        <View
          style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 4 }]}
          pointerEvents="box-none"
        >
          <View style={styles.trayRow}>
            <View style={styles.trayLeft}>
              {busy ? (
                <View style={styles.hintBubble}>
                  <ActivityIndicator color={colors.text} size="small" />
                  <Text style={styles.hintText}> Detecting card…</Text>
                </View>
              ) : lastAdded ? (
                (() => {
                  const econ = offerBreakdown(lastAdded.marketPrice);
                  return (
                    <Pressable style={styles.lastPill} onPress={onNext}>
                      {lastAdded.imageUrl ? (
                        <Image
                          source={{ uri: lastAdded.imageUrl }}
                          style={styles.lastThumb}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                        />
                      ) : null}
                      <View style={styles.lastInfo}>
                        <Text style={styles.lastName} numberOfLines={1}>
                          {lastAdded.name}
                        </Text>
                        <Text style={styles.lastMeta} numberOfLines={1}>
                          {lastAdded.number}
                          {lastAdded.subType ? ` • ${lastAdded.subType}` : ''}
                        </Text>
                        <Text style={styles.lastPrice} numberOfLines={1}>
                          Mkt ${lastAdded.marketPrice.toFixed(2)} · Offer $
                          {econ.offer.toFixed(2)} ({econ.offerPct}%)
                        </Text>
                        <Text style={styles.lastProfit} numberOfLines={1}>
                          Profit +${econ.profit.toFixed(2)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })()
              ) : (
                <View style={styles.hintBubble}>
                  <Text style={styles.hintText}>
                    {sessionRunning ? (
                      <>
                        Scan the <Text style={styles.hintBold}>front</Text> of
                        the card to get started.
                      </>
                    ) : (
                      'Camera starting…'
                    )}
                  </Text>
                </View>
              )}
            </View>
            {lastAdded && !busy ? (
              <View style={styles.modifyHint}>
                <Ionicons
                  name="arrow-back"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={styles.modifyHintText}>
                  Tap this to{'\n'}modify details
                </Text>
              </View>
            ) : null}
          </View>

          {error ? (
            <View style={styles.errorBubble}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.totalText}>
            Total: ${queueTotal.toFixed(2)}
          </Text>

          <View style={styles.shutterRow}>
            <View style={styles.shutterSide} />
            <ShutterButton
              onPress={handleShutter}
              loading={busy}
              disabled={busy || !sessionRunning}
            />
            <View style={[styles.shutterSide, styles.shutterRight]}>
              <Pressable
                onPress={onNext}
                disabled={queueCount === 0}
                style={[
                  styles.nextButton,
                  queueCount === 0 && styles.nextButtonDisabled,
                ]}
              >
                <Text style={styles.nextText}>Next</Text>
                <Ionicons name="arrow-forward" size={15} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/* Processing indicator — without this a multi-second first scan reads
          as a frozen app. */}
      {busy ? (
        <View style={styles.processingOverlay} pointerEvents="none">
          <View style={styles.processingCard}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.processingText}>
              {isCropping ? 'Identifying card…' : 'Capturing…'}
            </Text>
          </View>
        </View>
      ) : null}

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
        />
      ) : null}

      {/* Debug overlay */}
      {debugOpen ? (
        <OcrDebugPanel top={insets.top + 52} info={debugInfo} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(14,17,23,0.9)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  processingText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  warmingPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(14,17,23,0.85)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warmingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  text: {
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    marginTop: 16,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonSecondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  topIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: 'rgba(4,6,10,0.55)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
  },
  trayLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  hintBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(10,12,15,0.75)',
    maxWidth: 240,
  },
  hintText: {
    color: colors.text,
    fontSize: 13,
  },
  hintBold: {
    fontWeight: 'bold',
    color: colors.primary,
  },
  lastPill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(10,12,15,0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'stretch',
    flexGrow: 1,
    maxWidth: 320,
  },
  lastThumb: {
    width: 38,
    height: 52,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  lastInfo: {
    marginLeft: 8,
    flexShrink: 1,
  },
  lastName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  lastMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  lastPrice: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 1,
  },
  lastProfit: {
    color: colors.success,
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 1,
  },
  modifyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  modifyHintText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  errorBubble: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
  },
  totalText: {
    alignSelf: 'flex-end',
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  shutterSide: {
    flex: 1,
  },
  shutterRight: {
    alignItems: 'flex-end',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  nextButtonDisabled: {
    opacity: 0.4,
  },
  nextText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
