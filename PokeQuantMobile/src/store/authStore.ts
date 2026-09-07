import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../api/supabaseClient';
import { clearSession, getSession, saveSession } from '../api/sessionStorage';
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
        console.error('Failed to persist session:', err)
      );
    } else {
      clearSession().catch((err) =>
        console.error('Failed to clear persisted session:', err)
      );
    }

    useInventoryStore.getState().loadForUser(userId);
    useVendorStore.getState().loadForUser(userId);
    if (userId) {
      useShowVendorStore.getState().loadVendorProfile();
    }
  },

  initialize: async () => {
    set({ isLoading: true });

    const stored = await getSession();
    if (stored?.access_token && stored?.refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });

      if (error) {
        console.warn('Failed to restore Supabase session:', error.message);
        await clearSession();
      } else if (data.session) {
        get().setSession(data.session);
      }
    }

    const { data } = await supabase.auth.getSession();
    get().setSession(data.session);

    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }

    const { data: subData } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
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
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Supabase signOut error:', error.message);
    }
    get().setSession(null);
  },
}));
