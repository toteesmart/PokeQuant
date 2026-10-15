// Organizer-screen text helpers — registration display naming and the
// prefilled SMS compose link for balance reminders.
import { Linking, Platform } from 'react-native';
import type { ShowRegistration } from './showVendorService';

export type VendorOption = { id: string; name: string };

export function displayName(reg: ShowRegistration): string {
  return reg.isManual ? reg.manualName || 'Vendor not on the app' : reg.vendorName || reg.vendorId;
}

// Opens the native Messages app with a prefilled balance reminder. iOS uses
// `&body=` (no `?`) — Android uses `?body=`.
export function sendReminderSms(phone: string, message: string) {
  const sep = Platform.OS === 'ios' ? '&' : '?';
  Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(message)}`).catch(() => {});
}
