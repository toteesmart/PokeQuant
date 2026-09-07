import { redact, redactString } from '../src/utils/log';

describe('redact', () => {
  it('leaves normal strings alone', () => {
    expect(redact('hello world')).toBe('hello world');
  });

  it('masks email addresses in strings', () => {
    const input = 'User email is user@example.com and that is it';
    expect(redactString(input)).toBe('User email is [REDACTED_EMAIL] and that is it');
  });

  it('masks JWT-like tokens in strings', () => {
    const token =
      'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(token)).toBe('[REDACTED_TOKEN]');
  });

  it('replaces values of sensitive keys', () => {
    const input = {
      name: 'Pikachu',
      access_token: 'secret-token',
      userId: 'u-123',
      nested: { password: 'hunter2', email: 'a@b.com' },
    };
    const output = redact(input) as typeof input;
    expect(output.name).toBe('Pikachu');
    expect(output.access_token).toBe('[REDACTED]');
    expect(output.userId).toBe('[REDACTED]');
    expect(output.nested.password).toBe('[REDACTED]');
    expect(output.nested.email).toBe('[REDACTED]');
  });

  it('redacts Error messages with tokens', () => {
    const token =
      'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const err = new Error(`failed with token ${token}`);
    const redacted = redact(err) as Error;
    expect(redacted.message).toContain('[REDACTED_TOKEN]');
  });
});
