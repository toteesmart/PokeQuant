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
const TOKEN_RE = /(?:[Bb]earer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

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
