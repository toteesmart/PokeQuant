import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const VENDOR_ENTITLEMENT_ID = 'Cardcache_pro';
export const FOUNDER_OFFERING_ID = 'founders';
export const PRO_OFFERING_ID = 'pro';
export const TEAM_EXTRA_OFFERING_ID = 'teams_extra_seat';
export const OFFERING_IDS = [FOUNDER_OFFERING_ID, PRO_OFFERING_ID, TEAM_EXTRA_OFFERING_ID];

export const REVENUECAT_PRODUCTS = {
  founderIndividual: 'cc_founder_individual_monthly',
  founderTeam: 'cc_founder_team3_monthly',
  proIndividual: 'cc_pro_individual_monthly',
  proTeam: 'cc_pro_team_base_monthly',
  proExtraSeat: 'cc_pro_team_extra_seat_monthly',
} as const;

type RevenueCatExtra = {
  iosApiKey?: string;
  androidApiKey?: string;
};

function isPlaceholder(value: string | undefined | null): boolean {
  return !value || value.includes('<YOUR_') || value.includes('<');
}

export function getRevenueCatApiKey(): string | null {
  const platform = Platform.OS as 'ios' | 'android';
  const envKey =
    platform === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

  if (!isPlaceholder(envKey)) {
    return envKey!;
  }

  const extra = Constants.expoConfig?.extra?.revenuecat as RevenueCatExtra | undefined;
  const extraKey = platform === 'ios' ? extra?.iosApiKey : extra?.androidApiKey;

  return isPlaceholder(extraKey) ? null : extraKey ?? null;
}
