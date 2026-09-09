import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Slider } from '@miblanchard/react-native-slider';

import { colors } from '../constants/colors';
import { Dropdown } from '../components/Dropdown';
import { NumericStepper } from '../components/NumericStepper';
import { BulkImportWizard } from '../components/BulkImportWizard';
import {
  useVendorStore,
  DEFAULT_TIERS,
  type RoundingMethod,
  ROUNDING_METHODS,
} from '../store/vendorStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useAuth } from '../hooks/useAuth';
import { useProgressStore } from '../store/progressStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useShowVendorStore } from '../store/showVendorStore';
import { PricingPreview } from '../components/PricingPreview';
import type { Team } from '../services/showVendorService';
import { syncVendorSubscription } from '../services/showVendorService';
import { downloadLatestMarketPrices } from '../services/CatalogDownloadService';
import {
  catalogImagesReady,
  ensureCatalogImagesDownloaded,
  warmCatalogImageIndex,
} from '../services/CatalogImageService';

const DOLLAR_INPUT_RE = /^\d*\.?\d*$/;
const PERCENT_INPUT_RE = /^\d*\.?\d*$/;

function parseDollar(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0) return null;
  return Number(v.toFixed(2));
}

function parsePercent(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0 || v > 100) return null;
  return v;
}

function sanitizeMinMax(
  min: number,
  max: number,
  changed: 'min' | 'max'
): { min: number; max: number } {
  const round2 = (n: number) => Number(n.toFixed(2));
  min = Math.max(0, round2(min));
  max = Math.max(0, round2(max));

  if (min >= max) {
    if (changed === 'min') {
      max = round2(min + 0.01);
    } else {
      min = round2(max - 0.01);
      if (min < 0) {
        min = 0;
        max = 0.01;
      }
    }
  }

  return { min, max };
}

function isDollarTextValid(text: string): boolean {
  if (text === '') return true;
  if (!DOLLAR_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0;
}

function isPercentTextValid(text: string): boolean {
  if (text === '') return true;
  if (!PERCENT_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0 && v <= 100;
}

function clampPercent(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function SettingsScreen() {
  const tiers = useVendorStore((state) => state.tiers);
  const setTiers = useVendorStore((state) => state.setTiers);
  const updateTier = useVendorStore((state) => state.updateTier);
  const stickerRules = useVendorStore((state) => state.stickerRules);
  const updateStickerRules = useVendorStore(
    (state) => state.updateStickerRules
  );

  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const deleteAccount = useInventoryStore((state) => state.deleteAccount);
  const isExtracting = useProgressStore((state) => state.isExtracting);
  const catalogLastUpdated = useProgressStore(
    (state) => state.catalogLastUpdated
  );
  const { logout } = useAuth();

  const profile = useShowVendorStore((state) => state.profile);
  const paymentsLive = profile?.paymentsLive ?? false;
  const isFounder = profile?.isFounder ?? false;
  const founderSeatNumber = profile?.founderSeatNumber;
  const hasFounderSeat = founderSeatNumber != null;
  const founderSeatsRemaining = profile?.founderSeatsRemaining ?? 0;
  const hasVendorEntitlement = useSubscriptionStore((state) => state.hasVendorEntitlement());
  const isVendor = profile?.isVendor || hasVendorEntitlement || isFounder || profile?.isTeamMember;

  const team = useShowVendorStore((state) => state.team);
  const teamLoading = useShowVendorStore((state) => state.teamLoading);
  const teamError = useShowVendorStore((state) => state.teamError);
  const loadTeam = useShowVendorStore((state) => state.loadTeam);
  const loadVendorProfile = useShowVendorStore((state) => state.loadVendorProfile);
  const redeemCode = useShowVendorStore((state) => state.redeemCode);
  const regenerateCode = useShowVendorStore((state) => state.regenerateCode);
  const removeMember = useShowVendorStore((state) => state.removeMember);
  const leaveTeamAction = useShowVendorStore((state) => state.leaveTeam);

  const [minInputs, setMinInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.minDollar))
  );
  const [maxInputs, setMaxInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.maxDollar))
  );
  const [marginInputs, setMarginInputs] = useState<string[]>(() =>
    tiers.map((t) => String(t.marginPercent))
  );
  const [importVisible, setImportVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [teamCodeInput, setTeamCodeInput] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const skipSyncRef = useRef(false);

  // Sync local input state with external store changes (e.g. remote load)
  // without clobbering edits made from this screen.
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setMinInputs(tiers.map((t) => String(t.minDollar)));
    setMaxInputs(tiers.map((t) => String(t.maxDollar)));
    setMarginInputs(tiers.map((t) => String(t.marginPercent)));
  }, [tiers]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        await useSubscriptionStore.getState().refreshCustomerInfo();
      } catch {
        // RevenueCat may not be configured or offline; continue with worker sync.
      }

      try {
        await syncVendorSubscription();
      } catch {
        // Worker sync is best-effort; offline failures are surfaced elsewhere.
      }

      if (!mounted) return;

      await Promise.all([
        loadVendorProfile().catch((err) => {
          console.error('Failed to load vendor profile from Settings:', err);
        }),
        loadTeam().catch(() => {
          // Team info is optional; failures are shown in the team card.
        }),
      ]);
    };

    refresh();

    return () => {
      mounted = false;
    };
  }, [loadVendorProfile, loadTeam]);

  const handleMinChange = (index: number, text: string) => {
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMaxChange = (index: number, text: string) => {
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMinBlur = (index: number) => {
    const raw = minInputs[index] ?? '';
    const parsed = parseDollar(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMinInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.minDollar);
        return next;
      });
      return;
    }

    const { min, max } = sanitizeMinMax(parsed, current.maxDollar, 'min');

    skipSyncRef.current = true;
    updateTier(index, { minDollar: min, maxDollar: max });
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = String(min);
      return next;
    });
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = String(max);
      return next;
    });
  };

  const handleMaxBlur = (index: number) => {
    const raw = maxInputs[index] ?? '';
    const parsed = parseDollar(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMaxInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.maxDollar);
        return next;
      });
      return;
    }

    const { min, max } = sanitizeMinMax(current.minDollar, parsed, 'max');

    skipSyncRef.current = true;
    updateTier(index, { minDollar: min, maxDollar: max });
    setMinInputs((prev) => {
      const next = [...prev];
      next[index] = String(min);
      return next;
    });
    setMaxInputs((prev) => {
      const next = [...prev];
      next[index] = String(max);
      return next;
    });
  };

  const handleMarginChange = (index: number, text: string) => {
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = text;
      return next;
    });
  };

  const handleMarginBlur = (index: number) => {
    const raw = marginInputs[index] ?? '';
    const parsed = parsePercent(raw);
    const current = tiers[index];

    if (parsed === null) {
      setMarginInputs((prev) => {
        const next = [...prev];
        next[index] = String(current.marginPercent);
        return next;
      });
      return;
    }

    const clamped = clampPercent(parsed);

    skipSyncRef.current = true;
    updateTier(index, { marginPercent: clamped });
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleMarginSliderChange = (index: number, value: number) => {
    const clamped = clampPercent(value);
    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleMarginSliderComplete = (index: number, value: number) => {
    const clamped = clampPercent(value);
    const current = tiers[index];

    if (clamped !== current.marginPercent) {
      skipSyncRef.current = true;
      updateTier(index, { marginPercent: clamped });
    }

    setMarginInputs((prev) => {
      const next = [...prev];
      next[index] = String(clamped);
      return next;
    });
  };

  const handleAddTier = () => {
    const last = tiers[tiers.length - 1];
    const newMin = last ? Number(last.maxDollar.toFixed(2)) : 0;
    const newMax = last ? Number((last.maxDollar + 10).toFixed(2)) : 10;
    const newMargin = last ? last.marginPercent : 50;
    const newTier = {
      minDollar: newMin,
      maxDollar: newMax,
      marginPercent: newMargin,
    };

    skipSyncRef.current = true;
    setTiers([...tiers, newTier]);
    setMinInputs((prev) => [...prev, String(newTier.minDollar)]);
    setMaxInputs((prev) => [...prev, String(newTier.maxDollar)]);
    setMarginInputs((prev) => [...prev, String(newTier.marginPercent)]);

    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
  };

  const handleRemoveTier = (index: number) => {
    if (tiers.length <= 1) return;

    skipSyncRef.current = true;
    setTiers(tiers.filter((_, i) => i !== index));
    setMinInputs((prev) => prev.filter((_, i) => i !== index));
    setMaxInputs((prev) => prev.filter((_, i) => i !== index));
    setMarginInputs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetTiers = () => {
    const next = DEFAULT_TIERS.map((t) => ({ ...t }));

    skipSyncRef.current = true;
    setTiers(next);
    setMinInputs(next.map((t) => String(t.minDollar)));
    setMaxInputs(next.map((t) => String(t.maxDollar)));
    setMarginInputs(next.map((t) => String(t.marginPercent)));
  };

  const handleDownloadPrices = async () => {
    try {
      await downloadLatestMarketPrices();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Price catalog download failed';
      Alert.alert('Download failed', message);
    }
  };

  const [imagesReady, setImagesReady] = useState(catalogImagesReady);
  const [downloadingImages, setDownloadingImages] = useState(false);

  const handleDownloadImages = async () => {
    setDownloadingImages(true);
    try {
      await ensureCatalogImagesDownloaded();
      await warmCatalogImageIndex();
      setImagesReady(catalogImagesReady());
      Alert.alert(
        'Offline images ready',
        'Card images are now stored on this device.'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Image download failed';
      Alert.alert('Download failed', message);
    } finally {
      setDownloadingImages(false);
    }
  };

  const activeTeam = team ?? profile?.team ?? null;

  const handleRedeem = async () => {
    const code = teamCodeInput.trim();
    if (!code) return;
    setIsRedeeming(true);
    try {
      await redeemCode(code);
      setTeamCodeInput('');
      Alert.alert('Joined team', 'You now have vendor access through this team.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not join team', message);
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await regenerateCode();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not regenerate code', message);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRemove = (memberUserId: string) => {
    Alert.alert(
      'Remove team member?',
      'They will lose vendor access immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMember(memberUserId);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Remove failed', message);
            }
          },
        },
      ]
    );
  };

  const handleLeave = () => {
    Alert.alert(
      'Leave team?',
      'You will lose vendor access through this team.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveTeamAction();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Leave failed', message);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete All Account Info',
      'This will permanently erase your cloud inventory, settings, and local database. This action cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteAccount();
              logout();
            } catch (err) {
              const message =
                err instanceof Error ? err.message : 'Delete failed';
              Alert.alert('Delete failed', message);
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Vendor Settings</Text>
        <Text style={styles.subtitle}>
          Buy tiers define the cash offers shown on Search & Buy cards.
        </Text>

        <View style={styles.tiers}>
          {tiers.map((tier, index) => {
            const marginText = marginInputs[index] ?? String(tier.marginPercent);
            const sliderValue = Number.isNaN(Number(marginText))
              ? tier.marginPercent
              : Number(marginText);

            return (
              <View key={`tier-${index}`} style={styles.tierCard}>
                <View style={styles.tierHeader}>
                  <Text style={styles.tierHeading}>Tier {index + 1}</Text>
                  <TouchableOpacity
                    style={[
                      styles.removeButton,
                      tiers.length === 1 && styles.removeButtonDisabled,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => handleRemoveTier(index)}
                    disabled={tiers.length === 1}>
                    <Text
                      style={[
                        styles.removeButtonText,
                        tiers.length === 1 && styles.removeButtonTextDisabled,
                      ]}>
                      Remove
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.tierRow}>
                  <View style={styles.tierCol}>
                    <Text style={styles.tierLabel}>Min ($)</Text>
                    <TextInput
                      style={[
                        styles.input,
                        !isDollarTextValid(minInputs[index] ?? '') &&
                          styles.inputInvalid,
                      ]}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      value={minInputs[index]}
                      onChangeText={(text) => handleMinChange(index, text)}
                      onBlur={() => handleMinBlur(index)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.tierCol}>
                    <Text style={styles.tierLabel}>Max ($)</Text>
                    <TextInput
                      style={[
                        styles.input,
                        !isDollarTextValid(maxInputs[index] ?? '') &&
                          styles.inputInvalid,
                      ]}
                      placeholder="10"
                      placeholderTextColor={colors.textMuted}
                      value={maxInputs[index]}
                      onChangeText={(text) => handleMaxChange(index, text)}
                      onBlur={() => handleMaxBlur(index)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <View style={styles.marginControl}>
                  <Text style={styles.tierLabel}>Margin (%)</Text>
                  <View style={styles.sliderRow}>
                    <Slider
                      containerStyle={styles.slider}
                      value={sliderValue}
                      minimumValue={1}
                      maximumValue={100}
                      step={1}
                      minimumTrackTintColor={colors.primary}
                      maximumTrackTintColor={colors.border}
                      thumbTintColor={colors.primary}
                      onValueChange={(value) =>
                        handleMarginSliderChange(index, value[0])
                      }
                      onSlidingComplete={(value) =>
                        handleMarginSliderComplete(index, value[0])
                      }
                    />
                    <TextInput
                      style={[
                        styles.marginInput,
                        !isPercentTextValid(marginText) &&
                          styles.inputInvalid,
                      ]}
                      placeholder="50"
                      placeholderTextColor={colors.textMuted}
                      value={marginText}
                      onChangeText={(text) => handleMarginChange(index, text)}
                      onBlur={() => handleMarginBlur(index)}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              </View>
            );
          })}

          <View style={styles.tierActions}>
            <TouchableOpacity
              style={styles.addButton}
              activeOpacity={0.8}
              onPress={handleAddTier}>
              <Text style={styles.addButtonText}>Add Tier</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resetButton}
              activeOpacity={0.8}
              onPress={handleResetTiers}>
              <Text style={styles.resetButtonText}>Reset to Defaults</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Sticker Price Rules</Text>
          <Text style={styles.sectionSubtitle}>
            Configure how projected sticker prices are rounded and floored
            before they hit your inventory.
          </Text>

          <View style={styles.ruleRow}>
            <View style={styles.ruleFull}>
              <Dropdown
                label="Rounding Method"
                options={ROUNDING_METHODS}
                value={stickerRules.roundingMethod}
                onChange={(v) =>
                  updateStickerRules({ roundingMethod: v as RoundingMethod })
                }
              />
            </View>
          </View>

          <View style={styles.ruleRow}>
            <View style={styles.ruleHalf}>
              <NumericStepper
                label="Floor/Ceil Cutoff Threshold"
                value={stickerRules.cutoff}
                step={0.05}
                min={0}
                max={1}
                decimalPlaces={2}
                onChange={(v) => updateStickerRules({ cutoff: v })}
              />
            </View>
            <View style={styles.ruleHalf}>
              <NumericStepper
                label="Minimum Sticker Price ($)"
                value={stickerRules.minSticker}
                step={0.5}
                min={0}
                decimalPlaces={2}
                onChange={(v) => updateStickerRules({ minSticker: v })}
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Bulk Import</Text>
          <Text style={styles.sectionSubtitle}>
            Import a CSV or Excel file and verify each row against the catalog
            before committing to inventory.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.8}
            onPress={() => setImportVisible(true)}>
            <Text style={styles.primaryButtonText}>Open Import Wizard</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Offline Data Management</Text>
          <Text style={styles.sectionSubtitle}>
            Download the latest market price catalog. This updates only the
            pricing database and does not download card images.
          </Text>

          <Text style={styles.offlineTimestamp}>
            Last Updated:{' '}
            {catalogLastUpdated != null
              ? new Date(catalogLastUpdated).toLocaleString()
              : 'Unknown'}
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              isExtracting && styles.primaryButtonDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleDownloadPrices}
            disabled={isExtracting}>
            {isExtracting ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator
                  color={colors.text}
                  size="small"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryButtonText}>
                  Downloading Prices...
                </Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>
                Download Latest Market Prices
              </Text>
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
            disabled={downloadingImages || imagesReady}>
            {downloadingImages ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator
                  color={colors.text}
                  size="small"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryButtonText}>
                  Downloading Images...
                </Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>
                {imagesReady
                  ? 'Offline Images Downloaded'
                  : 'Download Offline Images (~1.8 GB)'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.devCard}>
          <Text style={styles.devTitle}>Subscription</Text>
          <Text style={styles.devSubtitle}>
            {isFounder
              ? `Founder #${founderSeatNumber ?? '—'} · ${founderSeatsRemaining} founder seat(s) remain`
              : hasFounderSeat
              ? `Founder #${founderSeatNumber ?? '—'} is held but inactive. Subscribe to a Founder plan to reactivate.`
              : isVendor
              ? 'Card Cache Pro is active.'
              : paymentsLive
              ? 'Cloud sync and show uploads require a Pro plan.'
              : 'Pricing preview is enabled. Purchases are not live yet.'}
          </Text>

          {!isFounder && !hasFounderSeat && paymentsLive && (
            <Text style={styles.noticeText}>
              {founderSeatsRemaining > 0
                ? `${founderSeatsRemaining} founder seat(s) remain. Lock in founder pricing before they sell out.`
                : 'Founder seats are full. Upgrade to Pro to unlock vendor features.'}
            </Text>
          )}

          {isFounder && isVendor && (
            <Text style={styles.warningText}>
              Your Founder discount is active while subscribed. If you cancel, you will lose it and pay full price if you return.
            </Text>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.primaryButton, { flex: 1, marginRight: 8 }]}
              activeOpacity={0.7}
              onPress={() => setShowPaywall(true)}>
              <Text style={styles.primaryButtonText}>
                {paymentsLive ? 'Manage subscription' : 'View pricing preview'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, { flex: 1 }]}
              activeOpacity={0.7}
              onPress={() => {
                useSubscriptionStore.getState().restorePurchases().catch((err) => {
                  const message = err instanceof Error ? err.message : String(err);
                  Alert.alert('Restore failed', message);
                });
              }}>
              <Text style={styles.secondaryButtonText}>Restore purchases</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.devCard}>
          <Text style={styles.devTitle}>Team</Text>
          <Text style={styles.devSubtitle}>
            {activeTeam?.is_owner
              ? `You are the team owner. Share the invite code with teammates.`
              : activeTeam?.is_member
                ? 'You have vendor access through a team.'
                : isVendor
                  ? 'You have an individual plan. Create or join a team to share access.'
                  : 'Join a team with an invite code to unlock vendor features.'}
          </Text>

          {teamError ? <Text style={styles.errorText}>{teamError}</Text> : null}

          {activeTeam?.is_owner ? (
            <>
              <View style={styles.teamCodeBox}>
                <Text style={styles.teamCodeLabel}>Invite code</Text>
                <Text style={styles.teamCodeValue}>{activeTeam.invite_code ?? '—'}</Text>
              </View>

              <Text style={styles.teamSeatsText}>
                Seats: {activeTeam.members?.length ?? activeTeam.seats_used ?? 0} / {activeTeam.seats_total}
              </Text>

              <TouchableOpacity
                style={[styles.primaryButton, isRegenerating && styles.primaryButtonDisabled]}
                activeOpacity={0.8}
                onPress={handleRegenerate}
                disabled={isRegenerating}>
                {isRegenerating ? (
                  <View style={styles.buttonRow}>
                    <ActivityIndicator color={colors.text} size="small" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryButtonText}>Regenerating...</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryButtonText}>Regenerate invite code</Text>
                )}
              </TouchableOpacity>

              {activeTeam.members && activeTeam.members.length > 0 && (
                <View style={styles.memberList}>
                  {activeTeam.members.map((m) => (
                    <View key={m.member_user_id} style={styles.memberRow}>
                      <Text style={styles.memberText} numberOfLines={1}>
                        {m.member_name?.trim() || `${m.member_user_id.slice(0, 12)}...`}
                      </Text>
                      <TouchableOpacity
                        style={styles.memberRemove}
                        activeOpacity={0.7}
                        onPress={() => handleRemove(m.member_user_id)}>
                        <Text style={styles.memberRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : activeTeam?.is_member ? (
            <>
              <Text style={styles.teamSeatsText}>
                Team ID: {activeTeam.team_id.slice(0, 16)}...
              </Text>
              <TouchableOpacity
                style={[styles.dangerButton, { marginTop: 12 }]}
                activeOpacity={0.7}
                onPress={handleLeave}>
                <Text style={styles.dangerButtonText}>Leave team</Text>
              </TouchableOpacity>
            </>
          ) : !isVendor ? (
            <>
              <View style={styles.teamInputRow}>
                <TextInput
                  style={styles.teamInput}
                  placeholder="6-digit invite code"
                  placeholderTextColor={colors.textMuted}
                  value={teamCodeInput}
                  onChangeText={setTeamCodeInput}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!isRedeeming}
                />
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { flex: 1, marginLeft: 8 },
                    (!teamCodeInput.trim() || isRedeeming) && styles.primaryButtonDisabled,
                  ]}
                  activeOpacity={0.8}
                  onPress={handleRedeem}
                  disabled={!teamCodeInput.trim() || isRedeeming}>
                  {isRedeeming ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Join</Text>
                  )}
                </TouchableOpacity>
              </View>
              {teamLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}
            </>
          ) : null}
        </View>

        <View style={styles.devCard}>
          <Text style={styles.devTitle}>Danger Zone</Text>
          <Text style={styles.devSubtitle}>
            Permanently delete all account data from the cloud and this device.
          </Text>
          <TouchableOpacity
            style={[
              styles.dangerButton,
              (isSyncing || isDeleting) && styles.dangerButtonDisabled,
            ]}
            activeOpacity={0.7}
            onPress={handleDeleteAccount}
            disabled={isSyncing || isDeleting}>
            {isDeleting ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.dangerButtonText}>
                Delete All Account Info
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            These percentage values are used by Search & Buy to calculate
            dynamic cash offers based on each card's live market price.
          </Text>
        </View>
      </ScrollView>

      <BulkImportWizard
        visible={importVisible}
        onClose={() => setImportVisible(false)}
      />

      <Modal
        visible={showPaywall}
        animationType="slide"
        onRequestClose={() => setShowPaywall(false)}>
        <PricingPreview
          allowSkip
          onSkip={() => setShowPaywall(false)}
          onClose={() => setShowPaywall(false)}
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 20,
  },
  tiers: {
    gap: 12,
  },
  tierCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tierHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  removeButtonText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  removeButtonTextDisabled: {
    color: colors.textMuted,
  },
  tierRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
  },
  tierCol: {
    flex: 1,
    paddingHorizontal: 6,
  },
  tierLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputInvalid: {
    borderColor: colors.error,
  },
  marginControl: {
    marginTop: 4,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slider: {
    flex: 1,
    marginRight: 12,
    height: 40,
  },
  marginInput: {
    width: 64,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  tierActions: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginTop: 8,
  },
  addButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  addButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  resetButton: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
    marginBottom: 12,
  },
  ruleFull: {
    flex: 1,
    paddingHorizontal: 6,
  },
  ruleHalf: {
    flex: 1,
    paddingHorizontal: 6,
  },
  notice: {
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  warningText: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineTimestamp: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  devCard: {
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  devTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  devSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  dangerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerButtonDisabled: {
    opacity: 0.5,
  },
  dangerButtonText: {
    color: colors.error,
    fontSize: 16,
    fontWeight: 'bold',
  },
  teamCodeBox: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  teamCodeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  teamCodeValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  teamSeatsText: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 14,
  },
  teamInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamInput: {
    width: 140,
    backgroundColor: colors.background,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  memberList: {
    marginTop: 14,
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
  },
  memberText: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
  },
  memberRemove: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  memberRemoveText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
});
