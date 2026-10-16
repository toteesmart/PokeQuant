// Data on this phone — price-list refresh + optional offline image
// packs (EN ~1.8 GB, JP optional). JP download also kicks the scanner
// JP embedding sidecar in the background; EmbeddingCache merges on
// next access.
import { useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../constants/colors';
import { CollapsibleSection } from '../CollapsibleSection';
import { useProgressStore } from '../../store/progressStore';
import { downloadLatestMarketPrices } from '../../services/CatalogDownloadService';
import {
  catalogImagesReady,
  catalogJpImagesReady,
  ensureCatalogImagesDownloaded,
  ensureJpImagesDownloaded,
  warmCatalogImageIndex,
} from '../../services/CatalogImageService';
import { ensureScannerAssets } from '../../scanner/services/ScannerAssetService';
import { toErrorMessage } from '../../utils/log';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

export function OfflineDataSection({ expanded, onToggle }: Props) {
  const isExtracting = useProgressStore((state) => state.isExtracting);
  const catalogDownloadProgress = useProgressStore((state) => state.catalogDownloadProgress);
  const catalogDownloadPhase = useProgressStore((state) => state.catalogDownloadPhase);
  const catalogLastUpdated = useProgressStore((state) => state.catalogLastUpdated);

  const [imagesReady, setImagesReady] = useState(catalogImagesReady);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [jpImagesReady, setJpImagesReady] = useState(catalogJpImagesReady);
  const [downloadingJpImages, setDownloadingJpImages] = useState(false);

  const handleDownloadPrices = async () => {
    try {
      await downloadLatestMarketPrices();
      Alert.alert('Market prices updated', 'The latest price list is saved on this phone.');
    } catch (err) {
      Alert.alert('Download failed', toErrorMessage(err));
    }
  };

  const handleDownloadImages = async () => {
    setDownloadingImages(true);
    try {
      await ensureCatalogImagesDownloaded();
      await warmCatalogImageIndex();
      setImagesReady(catalogImagesReady());
      Alert.alert('Offline images ready', 'Card photos are now saved on this phone.');
    } catch (err) {
      Alert.alert('Download failed', toErrorMessage(err));
    } finally {
      setDownloadingImages(false);
    }
  };

  const handleDownloadJpImages = async () => {
    setDownloadingJpImages(true);
    try {
      await ensureJpImagesDownloaded();
      await warmCatalogImageIndex();
      setJpImagesReady(catalogJpImagesReady());
      // Fetch the optional JP embedding sidecar now that JP images are
      // installed — ensureScannerAssets skips it until this point. Runs in
      // the background; EmbeddingCache merges the rows on next access.
      ensureScannerAssets().catch((e) => console.warn('JP scanner assets fetch failed', e));
      Alert.alert(
        'Japanese images ready',
        'Japanese card images are now stored on this device, and the scanner will recognize JP cards.',
      );
    } catch (err) {
      Alert.alert('Download failed', toErrorMessage(err));
    } finally {
      setDownloadingJpImages(false);
    }
  };

  return (
    <CollapsibleSection
      title="Data on this phone"
      expanded={expanded}
      onToggle={onToggle}
      maxHeight={600}
    >
      <Text style={styles.sectionSubtitle}>
        Download the latest price list. This only updates prices — card photos download separately.
      </Text>

      <Text style={styles.offlineTimestamp}>
        Last Updated:{' '}
        {catalogLastUpdated != null ? new Date(catalogLastUpdated).toLocaleString() : 'Unknown'}
      </Text>

      <TouchableOpacity
        style={[styles.primaryButton, isExtracting && styles.primaryButtonDisabled]}
        activeOpacity={0.8}
        onPress={handleDownloadPrices}
        disabled={isExtracting}
      >
        {isExtracting ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={colors.text} size="small" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>
              {catalogDownloadPhase === 'download'
                ? `Downloading prices… ${Math.round(catalogDownloadProgress * 100)}%`
                : 'Downloading prices…'}
            </Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>Download latest prices</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.primaryButton,
          { marginTop: 10 },
          (downloadingImages || imagesReady) && styles.primaryButtonDisabled,
        ]}
        activeOpacity={0.8}
        onPress={handleDownloadImages}
        disabled={downloadingImages || imagesReady}
      >
        {downloadingImages ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={colors.text} size="small" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>Downloading card photos...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>
            {imagesReady
              ? 'Card photos saved to this phone'
              : 'Save card photos to this phone (~1.8 GB)'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.primaryButton,
          { marginTop: 10 },
          (downloadingJpImages || jpImagesReady) && styles.primaryButtonDisabled,
        ]}
        activeOpacity={0.8}
        onPress={handleDownloadJpImages}
        disabled={downloadingJpImages || jpImagesReady}
      >
        {downloadingJpImages ? (
          <View style={styles.buttonRow}>
            <ActivityIndicator color={colors.text} size="small" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>Downloading Japanese photos...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>
            {jpImagesReady ? 'Japanese photos saved' : 'Save Japanese card photos (optional)'}
          </Text>
        )}
      </TouchableOpacity>
    </CollapsibleSection>
  );
}
