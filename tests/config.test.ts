import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it.each([undefined, '', '   ', '\n\t'])('rejects missing or blank token: %j', (token) => {
    const env: NodeJS.ProcessEnv = {};
    if (token !== undefined) env['TELEGRAM_BOT_TOKEN'] = token;

    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('rejects the example placeholder before contacting Telegram', () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: 'your_telegram_bot_token_here' }))
      .toThrow(/BotFather/);
  });

  it('reads the environment token and trims accidental surrounding whitespace', () => {
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: '  test-only-placeholder \n' }))
      .toEqual({ telegramBotToken: 'test-only-placeholder' });
  });
});
