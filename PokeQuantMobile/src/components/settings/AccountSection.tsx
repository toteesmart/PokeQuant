// Account cards — sign out (destructive-styled but non-destructive)
// and delete account (real two-step: confirm dialog → deleteAccount →
// logout). Delete is disabled while a sync is in flight so a partial
// push can't strand state.
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../constants/colors';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuth } from '../../hooks/useAuth';
import { toErrorMessage } from '../../utils/log';
import { styles } from './settingsStyles';

export function AccountSection() {
  const { logout } = useAuth();
  const isSyncing = useInventoryStore((state) => state.isSyncing);
  const deleteAccount = useInventoryStore((state) => state.deleteAccount);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Sign out of Card Cache?',
      'Any changes not backed up will stay on this phone until you back up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
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
              Alert.alert('Delete failed', toErrorMessage(err));
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionCardTitle}>Account</Text>
        <Text style={styles.devSubtitle}>
          Sign out of Card Cache on this device.
        </Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.7}
          onPress={handleLogout}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionCardTitle}>Delete account</Text>
        <Text style={styles.devSubtitle}>
          Permanently delete all account data from the cloud and this
          device.
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
              Delete everything
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}
