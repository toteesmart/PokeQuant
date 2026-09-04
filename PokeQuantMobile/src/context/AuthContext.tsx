import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../api/supabaseClient';
import { clearSession, getSession, saveSession } from '../api/sessionStorage';

type AuthContextValue = {
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

const AuthContext = createContext<AuthContextValue | null>(null);

function getUsernameFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as { username?: string } | undefined;
  return meta?.username ?? user.email?.split('@')[0] ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  const username = getUsernameFromUser(user);
  const isLoggedIn = !!user && !!session;

  // Restore a persisted session on app start.
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const stored = await getSession();

      if (stored?.access_token && stored?.refresh_token) {
        const { data, error } = await supabase.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        });

        if (!mounted) return;

        if (error) {
          console.warn('Failed to restore Supabase session:', error.message);
          await clearSession();
        } else if (data.session) {
          setSession(data.session);
          setUser(data.session.user);
        }
      }

      if (mounted) {
        setIsLoading(false);
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // Listen for Supabase auth state changes and mirror them into SecureStore.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession) {
        saveSession(newSession);
      } else if (event === 'SIGNED_OUT') {
        clearSession();
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (
    email: string,
    password: string
  ): Promise<Session | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
      await saveSession(data.session);
    }

    return data.session;
  };

  const signUp = async (
    email: string,
    password: string,
    username: string
  ): Promise<Session | null> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });

    if (error) throw error;

    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
      await saveSession(data.session);
    }

    return data.session;
  };

  const resetPassword = async (email: string): Promise<void> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const logout = async (): Promise<void> => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Supabase signOut error:', error.message);
    }
    setSession(null);
    setUser(null);
    await clearSession();
  };

  const value: AuthContextValue = {
    isLoggedIn,
    isLoading,
    userId,
    email,
    username,
    session,
    user,
    signIn,
    signUp,
    resetPassword,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
