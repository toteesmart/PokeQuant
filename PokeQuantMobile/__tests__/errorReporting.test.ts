/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules + re-require pattern for module-state isolation */
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

type SentryMock = {
  init: jest.Mock;
  captureException: jest.Mock;
  captureMessage: jest.Mock;
};

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

const errorUtils = (): ErrorUtilsLike =>
  (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils!;

const WORKING_SDK_FACTORY = () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
});

const DSN = 'https://abc123@o1.ingest.sentry.io/2';

describe('initErrorReporting', () => {
  let sentry: SentryMock;
  let reporting: typeof import('../src/services/errorReporting');
  let log: typeof import('../src/utils/log');
  let originalDsn: string | undefined;

  // The suite deliberately exercises log paths — keep output quiet.
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;

    jest.resetModules();
    jest.doMock('@sentry/react-native', WORKING_SDK_FACTORY);
    sentry = jest.requireMock<SentryMock>('@sentry/react-native');
    log = require('../src/utils/log');
    reporting = require('../src/services/errorReporting');
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    } else {
      process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
    }
  });

  it('is an explicit no-op in dev builds (__DEV__) — zero SDK contact', () => {
    reporting.initErrorReporting();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('is an explicit no-op when disabled even with a DSN', () => {
    reporting.initErrorReporting({ enabled: false, dsn: DSN });
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('is an explicit no-op when enabled without a DSN', () => {
    reporting.initErrorReporting({ enabled: true, dsn: null });
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('treats placeholder DSNs as absent', () => {
    reporting.initErrorReporting({ enabled: true, dsn: '<YOUR_SENTRY_DSN>' });
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('resolves the DSN from EXPO_PUBLIC_SENTRY_DSN when not passed', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    reporting.initErrorReporting({ enabled: true });
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, beforeSend: expect.any(Function) }),
    );
  });

  // Sentry's default ReactNativeErrorHandlers integration owns the
  // ErrorUtils wrap — we must not double-wrap it (double-capture + dedupe
  // risk on the real fatal event). Pin that our init leaves it alone.
  it('does not touch the global error handler — the SDK integration owns it', () => {
    const handler = errorUtils().getGlobalHandler();
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    expect(errorUtils().getGlobalHandler()).toBe(handler);
  });

  it('initializes once across repeat init calls', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it('warns when a repeat init passes a different DSN', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    reporting.initErrorReporting({ enabled: true, dsn: 'https://other@o1.ingest.sentry.io/3' });
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(jest.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining('already initialized'),
    );
  });

  it('a failed sentry.init leaves a retryable state', () => {
    sentry.init.mockImplementationOnce(() => {
      throw new Error('bad dsn');
    });
    expect(() => reporting.initErrorReporting({ enabled: true, dsn: DSN })).not.toThrow();

    sentry.init.mockImplementation(() => {});
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    expect(sentry.init).toHaveBeenCalledTimes(2);
  });

  it('forwards logError payloads to the sink, redacted', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    log.logError('sync failed for user@example.com', { token: 'abc', count: 2 });

    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'sync failed for [REDACTED_EMAIL]',
      expect.objectContaining({ level: 'error' }),
    );
    const details = sentry.captureMessage.mock.calls[0][1].extra.details;
    expect(details[0].token).toBe('[REDACTED]');
    expect(details[0].count).toBe(2);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('routes an Error detail through captureException', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    log.logError('op failed', new Error('kaboom'));

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'kaboom' }),
      expect.objectContaining({
        extra: expect.objectContaining({ message: 'op failed' }),
      }),
    );
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('never propagates sink failures into logError (fire-and-forget)', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    sentry.captureMessage.mockImplementation(() => {
      throw new Error('offline');
    });
    expect(() => log.logError('still fine')).not.toThrow();
  });

  it('redacts Sentry events in beforeSend', () => {
    reporting.initErrorReporting({ enabled: true, dsn: DSN });
    const { beforeSend } = sentry.init.mock.calls[0][0];
    const out = beforeSend({ user: { email: 'a@b.com' }, message: 'hi a@b.com' });
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.message).toBe('hi [REDACTED_EMAIL]');
  });

  it('no-ops when the SDK cannot be loaded (pre-dependency dev clients)', () => {
    jest.resetModules();
    jest.doMock('@sentry/react-native', () => {
      throw new Error('native module missing');
    });
    const fresh = require('../src/services/errorReporting') as typeof reporting;

    expect(() => fresh.initErrorReporting({ enabled: true, dsn: DSN })).not.toThrow();
  });
});
