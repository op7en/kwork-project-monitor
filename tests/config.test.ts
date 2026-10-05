import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it.each([undefined, '', '   ', '\n\t'])('rejects missing or blank token: %j', (token) => {
    const env: NodeJS.ProcessEnv = { TELEGRAM_OWNER_ID: '123456789' };
    if (token !== undefined) env['TELEGRAM_BOT_TOKEN'] = token;

    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('rejects the example placeholder before contacting Telegram', () => {
    expect(() => loadConfig({
      TELEGRAM_BOT_TOKEN: 'your_telegram_bot_token_here',
      TELEGRAM_OWNER_ID: '123456789',
    }))
      .toThrow(/BotFather/);
  });

  it('reads the environment token and trims accidental surrounding whitespace', () => {
    expect(loadConfig({
      TELEGRAM_BOT_TOKEN: '  test-only-placeholder \n',
      TELEGRAM_OWNER_ID: ' 123456789 \n',
    })).toEqual({ telegramBotToken: 'test-only-placeholder', telegramOwnerId: 123456789 });
  });

  it.each([undefined, '', '   '])('rejects missing or blank owner ID: %j', (ownerId) => {
    const env: NodeJS.ProcessEnv = { TELEGRAM_BOT_TOKEN: 'test-only-placeholder' };
    if (ownerId !== undefined) env['TELEGRAM_OWNER_ID'] = ownerId;

    expect(() => loadConfig(env)).toThrowError(ConfigError);
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_OWNER_ID/);
  });

  it.each(['0', '-1', '+1', '1.5', '1e3', 'abc', '9007199254740992'])('rejects invalid owner ID %j', (ownerId) => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'test-only-placeholder',
      TELEGRAM_OWNER_ID: ownerId,
    };
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_OWNER_ID/);
  });

  it('accepts the largest safe positive integer owner ID', () => {
    expect(loadConfig({
      TELEGRAM_BOT_TOKEN: 'test-only-placeholder',
      TELEGRAM_OWNER_ID: '9007199254740991',
    }).telegramOwnerId).toBe(Number.MAX_SAFE_INTEGER);
  });
});
