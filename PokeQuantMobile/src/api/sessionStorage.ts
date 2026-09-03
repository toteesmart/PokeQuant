import * as SecureStore from 'expo-secure-store';
import type { Session } from '@supabase/supabase-js';

const SESSION_KEY = 'pq-supabase-session';

export async function saveSession(session: Session): Promise<void> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } catch (err) {
    console.error('Failed to persist Supabase session:', err);
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as Session;
  } catch (err) {
    console.error('Failed to load Supabase session:', err);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (err) {
    console.error('Failed to clear Supabase session:', err);
  }
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored) as Session;
    return session?.access_token ?? null;
  } catch (err) {
    console.error('Failed to read access token:', err);
    return null;
  }
}
