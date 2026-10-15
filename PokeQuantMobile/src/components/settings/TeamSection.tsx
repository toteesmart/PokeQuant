// Team — owner roster + invite-code lifecycle (rename, regenerate,
// remove member), member view (team name + leave), or the redeem
// field for non-vendors. Accounts and inventory stay per-user; the
// code only grants the Pro entitlement.
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { CollapsibleSection } from '../CollapsibleSection';
import { useShowVendorStore } from '../../store/showVendorStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { toErrorMessage } from '../../utils/log';
import { styles } from './settingsStyles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

export function TeamSection({ expanded, onToggle }: Props) {
  const profile = useShowVendorStore((state) => state.profile);
  const team = useShowVendorStore((state) => state.team);
  const teamLoading = useShowVendorStore((state) => state.teamLoading);
  const teamError = useShowVendorStore((state) => state.teamError);
  const redeemCode = useShowVendorStore((state) => state.redeemCode);
  const regenerateCode = useShowVendorStore(
    (state) => state.regenerateCode
  );
  const renameTeam = useShowVendorStore((state) => state.renameTeam);
  const removeMember = useShowVendorStore((state) => state.removeMember);
  const leaveTeamAction = useShowVendorStore((state) => state.leaveTeam);

  const hasVendorEntitlement = useSubscriptionStore((state) =>
    state.hasVendorEntitlement()
  );
  const isVendor =
    profile?.isVendor || hasVendorEntitlement || profile?.isTeamMember;
  const activeTeam = team ?? profile?.team ?? null;

  const [teamCodeInput, setTeamCodeInput] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Team name arriving late seeds the rename field once — render-adjusted.
  const loadedTeamName = activeTeam?.name ?? '';
  const [prevTeamName, setPrevTeamName] = useState(loadedTeamName);
  if (loadedTeamName !== prevTeamName) {
    setPrevTeamName(loadedTeamName);
    setTeamNameInput(loadedTeamName);
  }

  const handleRedeem = async () => {
    const code = teamCodeInput.trim();
    if (!code) return;
    setIsRedeeming(true);
    try {
      await redeemCode(code);
      setTeamCodeInput('');
      Alert.alert('Joined team', 'You now have your own Pro plan through this team. Your inventory stays on your account, not the owner’s.');
    } catch (err) {
      Alert.alert("Couldn't join team", toErrorMessage(err));
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await regenerateCode();
    } catch (err) {
      Alert.alert("Couldn't make a new code", toErrorMessage(err));
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRename = async () => {
    const name = teamNameInput.trim();
    if (!name || name === activeTeam?.name) return;
    setIsRenaming(true);
    try {
      await renameTeam(name);
    } catch (err) {
      Alert.alert("Couldn't rename team", toErrorMessage(err));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRemove = (memberUserId: string) => {
    Alert.alert(
      'Remove team member?',
      'They will lose their team spot and selling tools immediately. Their listings stay on their own account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMember(memberUserId);
            } catch (err) {
              Alert.alert('Remove failed', toErrorMessage(err));
            }
          },
        },
      ]
    );
  };

  const handleLeave = () => {
    Alert.alert(
      'Leave team?',
      'You will lose your team spot and selling tools through this team. Your listings stay on your own account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveTeamAction();
            } catch (err) {
              Alert.alert('Leave failed', toErrorMessage(err));
            }
          },
        },
      ]
    );
  };

  return (
    <CollapsibleSection
      title="Team"
      expanded={expanded}
      onToggle={onToggle}
      maxHeight={1000}>
      <Text style={styles.devSubtitle}>
        {activeTeam?.is_owner
          ? 'You are the team owner. Share the invite code to give each teammate their own Pro account — accounts and inventory are not shared.'
          : activeTeam?.is_member
            ? 'You have your own Pro account through this team. Your inventory is separate from the team owner’s and other members’.'
            : isVendor
              ? 'You have an individual Pro plan. Switch to a Team plan to add discounted Pro accounts for other sellers.'
              : 'Use a team invite code to get your own seller account.'}
      </Text>

      {teamError ? (
        <Text style={styles.errorText}>{teamError}</Text>
      ) : null}

      {activeTeam?.is_owner ? (
        <>
          <View style={styles.teamInputRow}>
            <TextInput
              style={styles.teamNameInput}
              placeholder="Team name"
              placeholderTextColor={colors.textMuted}
              value={teamNameInput}
              onChangeText={setTeamNameInput}
              maxLength={80}
              editable={!isRenaming}
            />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { flex: 1, marginLeft: 8 },
                (teamNameInput.trim() === activeTeam?.name ||
                  isRenaming) &&
                  styles.primaryButtonDisabled,
              ]}
              activeOpacity={0.8}
              onPress={handleRename}
              disabled={
                teamNameInput.trim() === activeTeam?.name || isRenaming
              }>
              {isRenaming ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.teamCodeBox}>
            <Text style={styles.teamCodeLabel}>Invite code</Text>
            <Text style={styles.teamCodeValue}>
              {activeTeam.invite_code ?? '—'}
            </Text>
          </View>

          <Text style={styles.teamSeatsText}>
            Seats: {activeTeam.members?.length ??
              activeTeam.seats_used ??
              0}{' '}
            / {activeTeam.seats_total}
          </Text>

          <Text style={styles.teamSeatsText}>
            Owner:{' '}
            {activeTeam.owner_name?.trim() ||
              activeTeam.name?.trim() ||
              '—'}
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              isRegenerating && styles.primaryButtonDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleRegenerate}
            disabled={isRegenerating}>
            {isRegenerating ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator
                  color={colors.text}
                  size="small"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryButtonText}>
                  Regenerating...
                </Text>
              </View>
            ) : (
              <Text style={styles.primaryButtonText}>
                Regenerate invite code
              </Text>
            )}
          </TouchableOpacity>

          {activeTeam.members && activeTeam.members.length > 0 && (
            <View style={styles.memberList}>
              {activeTeam.members.map((m, i) => (
                <View key={m.member_user_id} style={styles.memberRow}>
                  <Text style={styles.memberText} numberOfLines={1}>
                    Team member {i + 1}:{' '}
                    {m.member_name?.trim() ||
                      `${m.member_user_id.slice(0, 12)}...`}
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
            Team:{' '}
            {activeTeam.name?.trim() ||
              `${activeTeam.team_id.slice(0, 16)}...`}
          </Text>
          <Text style={styles.teamSeatsText}>
            Owner:{' '}
            {activeTeam.owner_name?.trim() ||
              activeTeam.name?.trim() ||
              '—'}
          </Text>

          {activeTeam.members && activeTeam.members.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              {activeTeam.members.map((m, i) => (
                <Text
                  key={m.member_user_id}
                  style={styles.teamSeatsText}>
                  Team member {i + 1}:{' '}
                  {m.member_name?.trim() ||
                    `${m.member_user_id.slice(0, 12)}...`}
                </Text>
              ))}
            </View>
          )}

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
                (!teamCodeInput.trim() || isRedeeming) &&
                  styles.primaryButtonDisabled,
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
          {teamLoading && (
            <ActivityIndicator
              color={colors.primary}
              style={{ marginTop: 12 }}
            />
          )}
        </>
      ) : null}
    </CollapsibleSection>
  );
}
