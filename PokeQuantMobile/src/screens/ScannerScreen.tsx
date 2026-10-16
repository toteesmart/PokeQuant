// ScannerScreen — the phase gate: assets check → download gate → camera
// (with camera/queue view switching and background warm-up). The live
// pipeline moved to scanner/organisms/ScannerCameraView; meter plumbing
// to hooks/useScanMeter; trade state to hooks/useTradeScan; chrome to
// scanner/molecules/Scanner*; styles to molecules/scannerScreenStyles.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { loadBinarySidecar } from '../scanner/services/visual/EmbeddingCache';
import { loadScannerCatalog } from '../scanner/services/catalog/ScannerCatalogProvider';
import { warmCardDetectorModel } from '../scanner/services/detection/CardDetector';
import { warmVisualEmbedderModel } from '../scanner/services/visual/VisualEmbedder';
import {
  areScannerAssetsReady,
  ensureScannerAssets,
} from '../scanner/services/ScannerAssetService';
import { ScannerDownloadGate } from '../scanner/organisms/ScannerDownloadGate';
import { ScanQueueView } from '../scanner/organisms/ScanQueueView';
import { ScannerCameraView } from '../scanner/organisms/ScannerCameraView';
import { scannerScreenStyles as styles } from '../scanner/molecules/scannerScreenStyles';

type Phase = 'checking' | 'gate' | 'ready';

type Props = {
  onClose?: () => void;
  onDone?: () => void;
  embedded?: boolean;
  /** False when the hosting surface is hidden (e.g. unfocused tab) — powers
   * down the camera sensor while the screen stays mounted. */
  active?: boolean;
};

export function ScannerScreen({ onClose, onDone, embedded = false, active = true }: Props) {
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
          // Base assets are ready — but the optional JP embedding pair may
          // still be missing (it downloads only after the JP image pack is
          // installed). ensureScannerAssets is a no-op when everything is on
          // disk; EmbeddingCache merges the rows whenever they land.
          ensureScannerAssets().catch((e) =>
            console.warn('ScannerScreen: JP asset check failed', e),
          );
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
    return <ScanQueueView onBack={() => setView('camera')} onDone={handleDone} />;
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
