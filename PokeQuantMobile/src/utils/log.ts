const SENSITIVE_KEYS = new Set([
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'id_token',
  'idToken',
  'password',
  'secret',
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'email',
  'userId',
  'user_id',
  'userID',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE = /(?:[Bb]earer\s+)?[A-Za-z0-9_+\-/]{8,}(?:\.[A-Za-z0-9_+\-/]{8,}){2,}/g;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(normalized);
}

export function redactString(value: string): string {
  return value
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(TOKEN_RE, '[REDACTED_TOKEN]');
}

export function redact<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value) as unknown as T;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Error) {
    const redacted = new Error(redactString(value.message));
    redacted.name = value.name;
    redacted.stack = value.stack ? redactString(value.stack) : undefined;
    return redacted as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map(redact) as unknown as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? '[REDACTED]' : redact(v);
    }
    return out as unknown as T;
  }

  return value;
}

export function logError(message: string, error?: unknown): void {
  console.error(message, error !== undefined ? redact(error) : undefined);
}

export function logWarn(message: string, error?: unknown): void {
  console.warn(message, error !== undefined ? redact(error) : undefined);
}

export function logInfo(message: string, data?: unknown): void {
  console.log(message, data !== undefined ? redact(data) : undefined);
}

function errorSource(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err == null) return '';
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.description === 'string') parts.push(e.description);
    if (typeof e.name === 'string') parts.push(e.name);
    if (typeof e.cause === 'string') parts.push(e.cause);
    if (e.cause instanceof Error) {
      parts.push(e.cause.message);
      parts.push(e.cause.name);
    }
    parts.push(String(err));
    return parts.join(' ');
  }
  return String(err);
}

export function toErrorMessage(err: unknown): string {
  return errorSource(err);
}

export function isOfflineError(err: unknown): boolean {
  const text = errorSource(err).toLowerCase();
  return (
    text.includes('offline') ||
    text.includes('internet connection') ||
    text.includes('network is unavailable') ||
    text.includes('network request failed') ||
    text.includes('fetch failed') ||
    text.includes('unable to resolve') ||
    text.includes('nsurlerrordomain') ||
    text.includes('code=-1009') ||
    text.includes('expo_modules_core') ||
    text.includes('promises.swift')
  );
}

export function toOfflineMessage(hasLocalData: boolean): string {
  return hasLocalData
    ? 'Internet connection is offline — using downloaded catalog.'
    : 'Internet connection is offline — connect to download.';
}
