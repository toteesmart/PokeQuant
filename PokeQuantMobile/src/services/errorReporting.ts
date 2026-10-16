import Constants from 'expo-constants';
import { logInfo, logWarn, redact, setErrorSink } from '../utils/log';

declare const __DEV__: boolean;

// Structural type for the slice of @sentry/react-native the sink uses.
// The SDK is require()'d lazily rather than imported: it is a native
// module, and dev-client builds produced before the dependency landed
// lack the native side — init must no-op there instead of crashing at
// startup. Metro still bundles the package for builds that do have it.
type SentryClient = {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, context?: Record<string, unknown>): void;
};

type ErrorReportingOptions = {
  dsn?: string | null;
  enabled?: boolean;
};

let initialized = false;
let client: SentryClient | null = null;
let activeDsn: string | null = null;

function resolveSentryDsn(): string | null {
  const envDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (envDsn && !envDsn.includes('<')) {
    return envDsn;
  }
  const extra = Constants.expoConfig?.extra?.sentry as { dsn?: string } | undefined;
  const extraDsn = extra?.dsn;
  return extraDsn && !extraDsn.includes('<') ? extraDsn : null;
}

function loadSentry(): SentryClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy require: keeps init safe on dev clients built before the dependency landed.
    const mod = require('@sentry/react-native') as SentryClient & {
      default?: SentryClient;
    };
    return mod.default ?? mod;
  } catch (err) {
    logWarn('Error reporting SDK unavailable — reporting disabled.', err);
    return null;
  }
}

const reportLoggedError = (message: string, details: unknown[]): void => {
  const active = client;
  if (!active) {
    return;
  }
  const firstError = details.find((detail): detail is Error => detail instanceof Error);
  if (firstError) {
    active.captureException(firstError, { extra: { message, details } });
  } else {
    active.captureMessage(message, { level: 'error', extra: { details } });
  }
};

// Idempotent gate: dev builds and missing-DSN environments are explicit
// no-ops (zero network, no throw), never silent. Safe to call at startup
// before auth/catalog state exists.
//
// Fatal-JS capture is deliberately NOT wired here: Sentry's default
// ReactNativeErrorHandlers integration already wraps ErrorUtils (with
// the proper fatal mechanism + flush) once init succeeds. Wrapping it
// again double-reports every crash and risks dedupe dropping the real
// fatal event.
export function initErrorReporting(options: ErrorReportingOptions = {}): void {
  const enabled = options.enabled ?? !__DEV__;
  if (!enabled) {
    logInfo('Error reporting disabled for this build.');
    return;
  }
  if (initialized) {
    if (options.dsn && options.dsn !== activeDsn) {
      logWarn('Error reporting already initialized — ignoring the new DSN.');
    }
    return;
  }
  const dsn = options.dsn === undefined ? resolveSentryDsn() : options.dsn;
  if (!dsn || dsn.includes('<')) {
    logWarn('Error reporting enabled but no DSN configured — reporting disabled.');
    return;
  }
  const sentry = loadSentry();
  if (!sentry) {
    return;
  }
  try {
    sentry.init({
      dsn,
      // The same redactor every log call goes through — emails, tokens,
      // and sensitive keys never leave the device.
      beforeSend: (event: unknown) => redact(event),
    });
  } catch (err) {
    logWarn('Error reporting init failed — reporting disabled.', err);
    return;
  }
  client = sentry;
  activeDsn = dsn;
  setErrorSink(reportLoggedError);
  initialized = true;
  logInfo('Error reporting initialized.');
}
