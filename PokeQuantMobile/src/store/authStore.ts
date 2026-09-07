import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../api/supabaseClient';
import { clearSession, getSession, saveSession } from '../api/sessionStorage';
import { logError, logWarn } from '../utils/log';
import { useInventoryStore } from './inventoryStore';
import { useVendorStore } from './vendorStore';
import { useShowVendorStore } from './showVendorStore';

export type AuthContextValue = {
  isLoggedIn: boolean;
  isLoading: boolean;
  userId: string | null;
  email: string | null;
  username: string | null;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<Session | null>;
  signUp: (
    email: string,
    password: string,
    username: string
  ) => Promise<Session | null>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

type AuthState = Omit<AuthContextValue, 'signIn' | 'signUp' | 'resetPassword' | 'logout'>;

type AuthActions = {
  signIn: (email: string, password: string) => Promise<Session | null>;
  signUp: (email: string, password: string, username: string) => Promise<Session | null>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  setSession: (session: Session | null) => void;
};

let authSubscription: { unsubscribe: () => void } | null = null;
// Tracks which user the stores were last hydrated for so repeated setSession
// calls (token refresh, auth state churn) don't each trigger a full reload.
let lastLoadedUserId: string | null | undefined;
// onAuthStateChange also fires SIGNED_OUT when a background token refresh
// fails — e.g. flaky network right after an offline-restored launch. Only an
// explicit logout() should tear the session down.
let userInitiatedSignOut = false;

function getUsernameFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as { username?: string } | undefined;
  return meta?.username ?? user.email?.split('@')[0] ?? null;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  isLoading: true,
  isLoggedIn: false,
  userId: null,
  email: null,
  username: null,
  session: null,
  user: null,

  setSession: (session) => {
    const user = session?.user ?? null;
    const userId = user?.id ?? null;

    set({
      session,
      user,
      userId,
      email: user?.email ?? null,
      username: getUsernameFromUser(user),
      isLoading: false,
      isLoggedIn: !!user && !!session,
    });

    if (session) {
      saveSession(session).catch((err) =>
        logError('Failed to persist session:', err)
      );
    } else {
      clearSession().catch((err) =>
        logError('Failed to clear persisted session:', err)
      );
    }

    if (lastLoadedUserId !== userId) {
      lastLoadedUserId = userId;
      useInventoryStore.getState().loadForUser(userId);
      useVendorStore.getState().loadForUser(userId);
      if (userId) {
        useShowVendorStore.getState().loadVendorProfile();
      }
    }
  },

  initialize: async () => {
    set({ isLoading: true });

    const stored = await getSession();
    let restoredFromStorage = false;
    if (stored?.access_token && stored?.refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });

      if (error) {
        // 4xx = the refresh token is genuinely invalid → drop the session.
        // Anything else (status 0/undefined/5xx) is a network/server blip:
        // keep the stored session and hydrate from it so the app still works
        // offline instead of looking logged-out with empty inventory.
        const status = (error as { status?: number }).status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          logWarn('Stored session is invalid:', error.message);
          await clearSession();
        } else {
          logWarn(
            'Session refresh unreachable; restoring stored session offline:',
            error.message
          );
          get().setSession(stored);
          restoredFromStorage = true;
        }
      } else if (data.session) {
        get().setSession(data.session);
      }
    }

    // supabase is configured with persistSession: false, so getSession() only
    // reflects whatever setSession() applied above — skip it entirely when we
    // already restored from storage, or it would wipe the session with null.
    if (!restoredFromStorage) {
      const { data } = await supabase.auth.getSession();
      get().setSession(data.session);
    }

    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }

    const { data: subData } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        // Null-session events must never tear down a restored session unless
        // the user explicitly logged out. Two cases:
        //  - SIGNED_OUT from a failed background token refresh (network blip).
        //  - INITIAL_SESSION fired when this subscription attaches: after an
        //    offline restore the client's in-memory session is empty, so it
        //    arrives with session = null and would wipe SecureStore too.
        if (!newSession && !userInitiatedSignOut) {
          return;
        }
        if (_event === 'SIGNED_OUT') {
          // This SIGNED_OUT is the result of an explicit logout; consume the
          // one-shot guard now so it cannot leak into a future event.
          userInitiatedSignOut = false;
        }
        get().setSession(newSession);
      }
    );
    authSubscription = subData.subscription;
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (data.session) {
      get().setSession(data.session);
    }
    return data.session;
  },

  signUp: async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });
    if (error) throw error;
    if (data.session) {
      get().setSession(data.session);
    }
    return data.session;
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  logout: async () => {
    userInitiatedSignOut = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        logError('Supabase signOut error:', error.message);
      }
    } finally {
      // Always clear the one-shot guard, even if signOut throws or a delayed
      // SIGNED_OUT never arrives. Otherwise a later spurious SIGNED_OUT from a
      // token-refresh network blip could be mistaken for a logout.
      userInitiatedSignOut = false;
      get().setSession(null);
    }
  },
}));
