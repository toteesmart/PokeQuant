import { useAuthStore, type AuthContextValue } from '../store/authStore';

export function useAuth(): AuthContextValue {
  return useAuthStore();
}
