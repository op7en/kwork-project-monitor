import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config/env.js';
import { loadGmailConfig } from '../src/config/gmail.js';

const valid = {
  GMAIL_CLIENT_ID: 'test-client-id',
  GMAIL_CLIENT_SECRET: 'test-client-secret',
  GMAIL_REFRESH_TOKEN: 'test-refresh-token',
  GMAIL_EXPECTED_ACCOUNT_EMAIL: 'owner@example.com',
};

describe('Gmail configuration independent of Telegram', () => {
  it('loads only Gmail settings and normalizes surrounding whitespace', () => {
    expect(loadGmailConfig({ ...valid, GMAIL_EXPECTED_ACCOUNT_EMAIL: ' Owner@Example.com ' }))
      .toEqual({
        clientId: 'test-client-id', clientSecret: 'test-client-secret',
        refreshToken: 'test-refresh-token', expectedAccountEmail: 'owner@example.com',
      });
  });

  it.each(Object.keys(valid))('rejects absent or blank %s without leaking input', (key) => {
    for (const value of [undefined, '', ' \n\t ']) {
      const env: NodeJS.ProcessEnv = { ...valid };
      if (value === undefined) delete env[key];
      else env[key] = value;
      expect(() => loadGmailConfig(env)).toThrowError(ConfigError);
      expect(() => loadGmailConfig(env)).toThrow(key);
    }
  });

  it.each([
    ['GMAIL_CLIENT_ID', 'your_google_client_id'],
    ['GMAIL_CLIENT_SECRET', 'your_google_client_secret'],
    ['GMAIL_REFRESH_TOKEN', 'your_google_refresh_token'],
    ['GMAIL_EXPECTED_ACCOUNT_EMAIL', 'your_email@example.com'],
  ])('rejects the example value of %s', (key, value) => {
    expect(() => loadGmailConfig({ ...valid, [key]: value })).toThrowError(ConfigError);
  });

  it.each(['no-address', 'user@', '@example.com', 'user @example.com', 'user@example', 'user\n@example.com'])(
    'rejects malformed expected email: %j', (email) => {
      expect(() => loadGmailConfig({ ...valid, GMAIL_EXPECTED_ACCOUNT_EMAIL: email }))
        .toThrowError(ConfigError);
    });
});
