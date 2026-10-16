import type { Session } from '@supabase/supabase-js';
import { supabase } from '../src/api/supabaseClient';
import * as sessionStorage from '../src/api/sessionStorage';
import { useAuthStore } from '../src/store/authStore';
import { useInventoryStore } from '../src/store/inventoryStore';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';
import { useVendorStore } from '../src/store/vendorStore';
import * as logModule from '../src/utils/log';
import { deferred, tick } from './helpers/async';
import { mkSession, mkUser } from './helpers/builders';

// authStore characterization pins — supabaseClient is a full mock (the
// real module constructs a network client at import) and sessionStorage
// is a partial mock (getAccessToken stays real). Dependent stores stay
// real modules with their actions swapped via setState. Module-level
// state (lastLoadedUserId / userInitiatedSignOut / authSubscription)
// can't be reset — beforeEach normalizes by driving setSession(null)
// instead of resetting modules.

jest.mock('../src/api/supabaseClient', () => ({
  supabase: {
    auth: {
      setSession: jest.fn(),
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('../src/api/sessionStorage', () => {
  const actual = jest.requireActual<typeof import('../src/api/sessionStorage')>(
    '../src/api/sessionStorage',
  );
  return {
    ...actual,
    getSession: jest.fn(),
    saveSession: jest.fn(),
    clearSession: jest.fn(),
  };
});

const mockAuthSetSession = supabase.auth.setSession as jest.Mock;
const mockAuthGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const mockSignInWithPassword = supabase.auth.signInWithPassword as jest.Mock;
const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockResetPassword = supabase.auth.resetPasswordForEmail as jest.Mock;
const mockSignOut = supabase.auth.signOut as jest.Mock;

const mockStoredGetSession = jest.mocked(sessionStorage.getSession);
const mockSaveSession = jest.mocked(sessionStorage.saveSession);
const mockClearSession = jest.mocked(sessionStorage.clearSession);

const errSpy = jest.spyOn(logModule, 'logError').mockImplementation(() => {});
const warnSpy = jest.spyOn(logModule, 'logWarn').mockImplementation(() => {});
const infoSpy = jest.spyOn(logModule, 'logInfo').mockImplementation(() => {});
void infoSpy;

const realInvLoad = useInventoryStore.getState().loadForUser;
const realVendorLoad = useVendorStore.getState().loadForUser;
const realLoadVendorProfile = useShowVendorStore.getState().loadVendorProfile;
const realSubLogin = useSubscriptionStore.getState().login;
const realSubLogout = useSubscriptionStore.getState().logout;

// Every swapped action must return a promise — authStore chains .catch()
// on two of them, and a bare undefined return throws inside setSession.
const mockInvLoad = jest.fn(async () => {});
const mockVendorLoad = jest.fn(async () => {});
const mockLoadVendorProfile = jest.fn(async () => {});
const mockSubLogin = jest.fn(async () => {});
const mockSubLogout = jest.fn(async () => {});

const stored = mkSession();
const refreshed = mkSession({ access_token: 'access-2', refresh_token: 'refresh-2' });

const auth = () => useAuthStore.getState();
const sub = (unsubscribe: jest.Mock = jest.fn()) => ({
  data: { subscription: { id: 'sub-1', callback: jest.fn(), unsubscribe } },
});
// The callback registered by the last initialize() call. Capture BEFORE
// any jest.clearAllMocks() — clearing wipes mock.calls too.
const cb = () =>
  mockOnAuthStateChange.mock.calls.at(-1)![0] as (event: string, session: Session | null) => void;

beforeEach(() => {
  // Install swapped actions first so the setSession(null) normalize below
  // fires mocks, never real loaders.
  useInventoryStore.setState({ loadForUser: mockInvLoad });
  useVendorStore.setState({ loadForUser: mockVendorLoad });
  useShowVendorStore.setState({ loadVendorProfile: mockLoadVendorProfile });
  useSubscriptionStore.setState({ login: mockSubLogin, logout: mockSubLogout });

  // (1) reset + re-arm every mock.
  mockAuthSetSession
    .mockReset()
    .mockResolvedValue({ data: { session: null, user: null }, error: null });
  mockAuthGetSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mockOnAuthStateChange.mockReset().mockImplementation(() => sub());
  mockSignInWithPassword.mockReset();
  mockSignUp.mockReset();
  mockResetPassword.mockReset();
  mockSignOut.mockReset();
  mockStoredGetSession.mockReset().mockResolvedValue(null);
  mockSaveSession.mockReset().mockResolvedValue(undefined);
  mockClearSession.mockReset().mockResolvedValue(undefined);
  mockInvLoad.mockReset().mockResolvedValue(undefined);
  mockVendorLoad.mockReset().mockResolvedValue(undefined);
  mockLoadVendorProfile.mockReset().mockResolvedValue(undefined);
  mockSubLogin.mockReset().mockResolvedValue(undefined);
  mockSubLogout.mockReset().mockResolvedValue(undefined);

  // (2) normalize module state: lastLoadedUserId → null, signed out.
  auth().setSession(null);

  // (3) wipe the record of the normalize call; implementations survive.
  jest.clearAllMocks();
});

afterAll(() => {
  useInventoryStore.setState({ loadForUser: realInvLoad });
  useVendorStore.setState({ loadForUser: realVendorLoad });
  useShowVendorStore.setState({ loadVendorProfile: realLoadVendorProfile });
  useSubscriptionStore.setState({ login: realSubLogin, logout: realSubLogout });
});

test('setSession(session) hydrates state and fans out to dependent stores once', () => {
  auth().setSession(stored);

  expect(auth().isLoggedIn).toBe(true);
  expect(auth().userId).toBe('user-1');
  expect(auth().email).toBe('ash@example.com');
  expect(auth().username).toBe('ash');
  expect(auth().isLoading).toBe(false);
  expect(auth().session).toBe(stored);
  expect(auth().user).toBe(stored.user);
  expect(mockSaveSession).toHaveBeenCalledWith(stored);
  expect(mockClearSession).not.toHaveBeenCalled();
  expect(mockInvLoad).toHaveBeenCalledWith('user-1');
  expect(mockVendorLoad).toHaveBeenCalledWith('user-1');
  expect(mockLoadVendorProfile).toHaveBeenCalledTimes(1);
  expect(mockSubLogin).toHaveBeenCalledWith('user-1');
});

test('username derives from user_metadata, then the email local-part, then null', () => {
  auth().setSession(mkSession({ user: mkUser({ user_metadata: {}, email: 'misty@example.com' }) }));
  expect(auth().username).toBe('misty');

  auth().setSession(mkSession({ user: mkUser({ user_metadata: {}, email: undefined }) }));
  expect(auth().username).toBeNull();
});

test('setSession(null) from signed-in clears state and the stored session', () => {
  auth().setSession(stored);
  jest.clearAllMocks();

  auth().setSession(null);

  expect(auth().isLoggedIn).toBe(false);
  expect(auth().userId).toBeNull();
  expect(auth().email).toBeNull();
  expect(auth().username).toBeNull();
  expect(auth().session).toBeNull();
  expect(auth().user).toBeNull();
  expect(auth().isLoading).toBe(false);
  expect(mockClearSession).toHaveBeenCalledTimes(1);
  expect(mockInvLoad).toHaveBeenCalledWith(null);
  expect(mockVendorLoad).toHaveBeenCalledWith(null);
  expect(mockLoadVendorProfile).not.toHaveBeenCalled();
  expect(mockSubLogin).not.toHaveBeenCalled();
});

test('loader fan-out is deduped per user id across session churn', () => {
  auth().setSession(stored);
  auth().setSession(refreshed);

  expect(mockInvLoad).toHaveBeenCalledTimes(1);
  expect(mockVendorLoad).toHaveBeenCalledTimes(1);
  expect(mockSubLogin).toHaveBeenCalledTimes(1);

  auth().setSession(mkSession({ user: mkUser({ id: 'user-2' }) }));

  expect(mockInvLoad).toHaveBeenCalledTimes(2);
  expect(mockInvLoad).toHaveBeenLastCalledWith('user-2');
  expect(mockSubLogin).toHaveBeenCalledTimes(2);
});

test('initialize: stored session + successful refresh hydrates from the refreshed session', async () => {
  mockStoredGetSession.mockResolvedValueOnce(stored);
  mockAuthSetSession.mockResolvedValueOnce({
    data: { session: refreshed, user: refreshed.user },
    error: null,
  });
  mockAuthGetSession.mockResolvedValueOnce({ data: { session: refreshed }, error: null });

  await auth().initialize();

  expect(mockAuthSetSession).toHaveBeenCalledWith({
    access_token: 'access-1',
    refresh_token: 'refresh-1',
  });
  expect(auth().session).toBe(refreshed);
  expect(auth().isLoggedIn).toBe(true);
  expect(auth().isLoading).toBe(false);
  expect(mockAuthGetSession).toHaveBeenCalledTimes(1);
  // QUIRK: setSession runs twice — once on the refresh result, once on the
  // trailing getSession — so saveSession fires twice with the same session.
  expect(mockSaveSession).toHaveBeenCalledTimes(2);
  expect(mockSaveSession).toHaveBeenNthCalledWith(1, refreshed);
  expect(mockSaveSession).toHaveBeenNthCalledWith(2, refreshed);
  expect(mockInvLoad).toHaveBeenCalledTimes(1); // dedup absorbs the double-set
  expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
});

it.each([undefined, 0, 500, 503])(
  'initialize: an unreachable refresh keeps the stored session (status %s)',
  async (status) => {
    mockStoredGetSession.mockResolvedValueOnce(stored);
    mockAuthSetSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'Network request failed', status },
    });

    await auth().initialize();

    expect(auth().session).toBe(stored);
    expect(auth().isLoggedIn).toBe(true);
    expect(mockClearSession).not.toHaveBeenCalled();
    expect(mockAuthGetSession).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toBe(
      'Session refresh unreachable; restoring stored session offline:',
    );
    expect(mockInvLoad).toHaveBeenCalledWith('user-1');
  },
);

it.each([400, 401])(
  'initialize: a 4xx refresh error drops the stored session (status %s)',
  async (status) => {
    mockStoredGetSession.mockResolvedValueOnce(stored);
    mockAuthSetSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'Invalid Refresh Token', status },
    });

    await auth().initialize();

    // clearSession fires twice: the invalid-token branch, then the
    // setSession(null) tear-down after getSession returns null.
    expect(mockClearSession).toHaveBeenCalledTimes(2);
    expect(mockAuthGetSession).toHaveBeenCalledTimes(1);
    expect(auth().session).toBeNull();
    expect(auth().isLoggedIn).toBe(false);
    expect(auth().isLoading).toBe(false);
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toBe('Stored session is invalid:');
  },
);

test('initialize: nothing stored lands signed out', async () => {
  await auth().initialize();

  expect(mockAuthSetSession).not.toHaveBeenCalled();
  expect(mockAuthGetSession).toHaveBeenCalledTimes(1);
  expect(auth().isLoggedIn).toBe(false);
  expect(auth().isLoading).toBe(false);
  expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
});

test('initialize: a stored session without a refresh token is treated as absent', async () => {
  mockStoredGetSession.mockResolvedValueOnce(
    mkSession({ refresh_token: undefined as unknown as string }),
  );

  await auth().initialize();

  expect(mockAuthSetSession).not.toHaveBeenCalled();
  expect(mockAuthGetSession).toHaveBeenCalledTimes(1);
  expect(auth().isLoggedIn).toBe(false);
});

test('isLoading flips true during initialize and back false after', async () => {
  const gate = deferred<Session | null>();
  mockStoredGetSession.mockReturnValueOnce(gate.promise);

  const p = auth().initialize();
  await tick();
  expect(auth().isLoading).toBe(true);

  gate.resolve(null);
  await p;
  expect(auth().isLoading).toBe(false);
});

test('null-session SIGNED_OUT and INITIAL_SESSION events never tear down a restored session', async () => {
  // Restore offline first so the store holds `stored`.
  mockStoredGetSession.mockResolvedValueOnce(stored);
  mockAuthSetSession.mockResolvedValueOnce({
    data: { session: null, user: null },
    error: { message: 'Network request failed', status: 503 },
  });
  await auth().initialize();
  const authCb = cb();

  authCb('SIGNED_OUT', null);
  expect(auth().session).toBe(stored);
  expect(auth().isLoggedIn).toBe(true);
  expect(mockClearSession).not.toHaveBeenCalled();

  authCb('INITIAL_SESSION', null);
  expect(auth().session).toBe(stored);
  expect(auth().isLoggedIn).toBe(true);
  expect(mockClearSession).not.toHaveBeenCalled();
});

test('TOKEN_REFRESHED applies the new session without reloading the stores', async () => {
  await auth().initialize(); // nothing stored → registers the auth callback
  auth().setSession(stored);
  const authCb = cb();
  jest.clearAllMocks();

  authCb('TOKEN_REFRESHED', refreshed);
  expect(auth().session).toBe(refreshed);
  expect(mockSaveSession).toHaveBeenCalledWith(refreshed);
  expect(mockInvLoad).not.toHaveBeenCalled(); // same user → deduped

  authCb('SIGNED_IN', mkSession({ user: mkUser({ id: 'user-2' }) }));
  expect(mockInvLoad).toHaveBeenCalledWith('user-2');
});

test('a second initialize unsubscribes the first auth subscription', async () => {
  const unsubA = jest.fn();
  const unsubB = jest.fn();
  mockOnAuthStateChange.mockReturnValueOnce(sub(unsubA)).mockReturnValueOnce(sub(unsubB));

  await auth().initialize();
  await auth().initialize();

  expect(unsubA).toHaveBeenCalledTimes(1);
  expect(unsubB).not.toHaveBeenCalled();
});

test('logout signs out, tears down, and logs out of RevenueCat', async () => {
  auth().setSession(stored);
  jest.clearAllMocks();
  mockSignOut.mockResolvedValueOnce({ error: null });

  await auth().logout();

  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(auth().isLoggedIn).toBe(false);
  expect(auth().session).toBeNull();
  expect(mockClearSession).toHaveBeenCalled();
  expect(mockInvLoad).toHaveBeenCalledWith(null);
  expect(mockVendorLoad).toHaveBeenCalledWith(null);
  expect(mockSubLogout).toHaveBeenCalledTimes(1);
});

test('a signOut error is logged but logout still tears down', async () => {
  auth().setSession(stored);
  jest.clearAllMocks();
  mockSignOut.mockResolvedValueOnce({ error: { message: 'nope' } });

  await auth().logout();

  expect(errSpy).toHaveBeenCalledWith('Supabase signOut error:', 'nope');
  expect(auth().isLoggedIn).toBe(false);
  expect(mockSubLogout).toHaveBeenCalledTimes(1);
});

test('a signOut rejection propagates but the finally still tears down', async () => {
  auth().setSession(stored);
  jest.clearAllMocks();
  mockSignOut.mockRejectedValueOnce('offline');

  await expect(auth().logout()).rejects.toBe('offline');

  expect(auth().isLoggedIn).toBe(false);
  expect(mockSubLogout).toHaveBeenCalledTimes(1);
});

test('the one-shot SIGNED_OUT guard is honored during logout and consumed once', async () => {
  await auth().initialize(); // registers the auth callback
  const authCb = cb();
  auth().setSession(stored);
  jest.clearAllMocks();

  // A SIGNED_OUT arriving while signOut() is in flight is the explicit
  // logout's own event — it tears down, consuming the one-shot guard.
  mockSignOut.mockImplementationOnce(async () => {
    authCb('SIGNED_OUT', null);
    return { error: null };
  });

  await auth().logout();

  // The callback tears down (clearSession) and logout's finally runs
  // setSession(null) again — clearSession fires twice on this path.
  expect(mockClearSession).toHaveBeenCalledTimes(2);
  expect(auth().isLoggedIn).toBe(false);

  auth().setSession(stored);
  jest.clearAllMocks();

  // Guard consumed — a later null-session SIGNED_OUT is ignored.
  authCb('SIGNED_OUT', null);
  expect(auth().isLoggedIn).toBe(true);
  expect(mockClearSession).not.toHaveBeenCalled();
});

test('signIn resolves the session and hydrates the store; errors reject untouched', async () => {
  mockSignInWithPassword.mockResolvedValueOnce({
    data: { session: stored, user: stored.user },
    error: null,
  });

  const result = await auth().signIn('ash@example.com', 'pw');

  expect(result).toBe(stored);
  expect(auth().isLoggedIn).toBe(true);
  expect(mockSignInWithPassword).toHaveBeenCalledWith({
    email: 'ash@example.com',
    password: 'pw',
  });

  auth().setSession(null);
  jest.clearAllMocks();
  const authErr = { message: 'Invalid login credentials', status: 400 };
  mockSignInWithPassword.mockResolvedValueOnce({
    data: { session: null, user: null },
    error: authErr,
  });

  await expect(auth().signIn('ash@example.com', 'pw')).rejects.toBe(authErr);
  expect(auth().isLoggedIn).toBe(false);
  expect(mockSaveSession).not.toHaveBeenCalled();
});

test('signUp hydrates on a returned session, resolves null without one, rethrows errors', async () => {
  mockSignUp.mockResolvedValueOnce({
    data: { session: stored, user: stored.user },
    error: null,
  });

  const result = await auth().signUp('ash@example.com', 'pw', 'ash');

  expect(result).toBe(stored);
  expect(auth().isLoggedIn).toBe(true);
  expect(mockSignUp).toHaveBeenCalledWith({
    email: 'ash@example.com',
    password: 'pw',
    options: { data: { username: 'ash' } },
  });

  auth().setSession(null);
  jest.clearAllMocks();
  mockSignUp.mockResolvedValueOnce({
    data: { session: null, user: stored.user },
    error: null,
  });

  await expect(auth().signUp('ash@example.com', 'pw', 'ash')).resolves.toBeNull();
  expect(auth().isLoggedIn).toBe(false);
  expect(mockSaveSession).not.toHaveBeenCalled();

  const authErr = { message: 'User already registered', status: 422 };
  mockSignUp.mockResolvedValueOnce({ data: { session: null, user: null }, error: authErr });
  await expect(auth().signUp('ash@example.com', 'pw', 'ash')).rejects.toBe(authErr);
});

test('resetPassword resolves on success and rethrows auth errors', async () => {
  mockResetPassword.mockResolvedValueOnce({ error: null });
  await auth().resetPassword('ash@example.com');
  expect(mockResetPassword).toHaveBeenCalledWith('ash@example.com');

  const authErr = { message: 'rate limited', status: 429 };
  mockResetPassword.mockResolvedValueOnce({ error: authErr });
  await expect(auth().resetPassword('ash@example.com')).rejects.toBe(authErr);
});
