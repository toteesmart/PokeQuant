// Settings — composition shell. Each collapsible section owns its
// store subscriptions, local form state, and handlers under
// components/settings/; this file only tracks which sections are open
// and the scroll position for tier-add autoscroll.
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopChrome, TOP_CHROME_CLEARANCE } from '../components/ui';
import { SettingsBackButton } from '../components/SettingsGear';
import { BuyTiersSection } from '../components/settings/BuyTiersSection';
import { StickerRulesSection } from '../components/settings/StickerRulesSection';
import { ImportExportSection } from '../components/settings/ImportExportSection';
import { OfflineDataSection } from '../components/settings/OfflineDataSection';
import { SubscriptionSection } from '../components/settings/SubscriptionSection';
import { TeamSection } from '../components/settings/TeamSection';
import { AccountSection } from '../components/settings/AccountSection';
import { useSettingsBootstrap } from '../hooks/useSettingsBootstrap';
import { styles } from '../components/settings/settingsStyles';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  useSettingsBootstrap();

  const [expanded, setExpanded] = useState({
    buyTiers: false,
    stickerRules: false,
    bulkImport: false,
    offlineData: false,
    subscription: false,
    team: false,
  });

  const toggleSection = (key: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <TopChrome
        left={<SettingsBackButton variant="glass" />}
        center={<Text style={styles.chromeTitle}>Settings</Text>}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + TOP_CHROME_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Seller settings</Text>

        <BuyTiersSection
          expanded={expanded.buyTiers}
          onToggle={() => toggleSection('buyTiers')}
          scrollRef={scrollRef}
        />
        <StickerRulesSection
          expanded={expanded.stickerRules}
          onToggle={() => toggleSection('stickerRules')}
        />
        <ImportExportSection
          expanded={expanded.bulkImport}
          onToggle={() => toggleSection('bulkImport')}
        />
        <OfflineDataSection
          expanded={expanded.offlineData}
          onToggle={() => toggleSection('offlineData')}
        />
        <SubscriptionSection
          expanded={expanded.subscription}
          onToggle={() => toggleSection('subscription')}
        />
        <TeamSection expanded={expanded.team} onToggle={() => toggleSection('team')} />
        <AccountSection />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
