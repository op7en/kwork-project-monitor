import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRuntimeConfig, parseRuntimeEnvFile, parseComposeEnvFile } from '../src/ops/configCheck.js';

const valid = {
  TELEGRAM_BOT_TOKEN: 'synthetic-do-not-contact', TELEGRAM_OWNER_ID: '123',
  GMAIL_CLIENT_ID: 'synthetic-client', GMAIL_CLIENT_SECRET: 'synthetic-secret',
  GMAIL_REFRESH_TOKEN: 'synthetic-refresh', GMAIL_EXPECTED_ACCOUNT_EMAIL: 'synthetic@example.com',
};
const text = (env: Record<string, string>) => Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');

it('validates synthetic application settings and preserves literal raw special characters with CRLF', () => {
  const env = { ...valid, GMAIL_CLIENT_SECRET: 'synthetic $VAR ${VAR} # hash "double" \'single\' spaces = end' };
  const content = '# Public synthetic only\r\n' + text(env).replaceAll('\n', '\r\n') + '\r\n';
  expect(parseRuntimeEnvFile(content)).toEqual(env);
  expect(() => checkRuntimeConfig(env)).not.toThrow();
});
it.each(Object.keys(valid))('refuses absent or empty required %s with no values', key => {
  const env: NodeJS.ProcessEnv = { ...valid }; delete env[key];
  expect(() => checkRuntimeConfig(env)).toThrow(`env_missing:${key}`);
  env[key] = ''; expect(() => checkRuntimeConfig(env)).toThrow(`env_missing:${key}`);
});
it.each(['MONITOR_INTERVAL_MINUTES=4', 'MONITOR_MAX_MESSAGES=101', 'MONITOR_MAX_SENDS=0'])('refuses invalid application limit %s', line => {
  expect(() => parseRuntimeEnvFile(text(valid) + '\n' + line)).toThrow('env_application_invalid');
});
it.each([
  'TELEGRAM_BOT_TOKEN', 'export TELEGRAM_BOT_TOKEN=synthetic',
  'UNKNOWN_SECRET=synthetic-hidden', 'MONITOR_ENABLED=true', 'NODE_OPTIONS=--inspect',
  'TELEGRAM_BOT_TOKEN =synthetic', '=synthetic-hidden',
])('refuses ambiguous/unapproved raw line without echoing it', line => {
  try { parseRuntimeEnvFile(text(valid) + '\n' + line); throw Error('accepted'); }
  catch (error) { expect((error as Error).message).toMatch(/^env_(syntax_invalid|unknown_key|duplicate_key)$/); }
});
it('refuses duplicates, controls, oversized content, BOM and whitespace that application trim would change', () => {
  expect(() => parseRuntimeEnvFile(text(valid) + '\nGMAIL_CLIENT_SECRET=other-synthetic')).toThrow('env_duplicate_key');
  expect(() => parseRuntimeEnvFile(text({ ...valid, GMAIL_CLIENT_SECRET: ' synthetic ' }))).toThrow('env_surrounding_whitespace');
  expect(() => parseRuntimeEnvFile(text({ ...valid, GMAIL_CLIENT_SECRET: 'synthetic\0hidden' }))).toThrow('env_syntax_invalid');
  expect(() => parseRuntimeEnvFile('x'.repeat(70000))).toThrow('env_syntax_invalid');
  expect(() => parseRuntimeEnvFile('\ufeff' + text(valid))).toThrow('env_syntax_invalid');
});
it('refuses placeholders and invalid account/owner without revealing their values', () => {
  for (const env of [{ ...valid, TELEGRAM_BOT_TOKEN: 'your_telegram_bot_token_here' },
    { ...valid, GMAIL_REFRESH_TOKEN: 'your_google_refresh_token' },
    { ...valid, TELEGRAM_OWNER_ID: 'synthetic-hidden-owner' },
    { ...valid, GMAIL_EXPECTED_ACCOUNT_EMAIL: 'synthetic-hidden-account' }]) {
    expect(() => checkRuntimeConfig(env)).toThrow('env_application_invalid');
  }
});
it('separates literal Compose settings from runtime settings and rejects interpolation/unsafe paths', () => {
  const env = { KWORK_RELEASE: 'e'.repeat(40), KWORK_SECRETS_FILE: '/etc/kwork-firstvds/bot.env',
    KWORK_STATE_DIR: '/var/lib/kwork-firstvds/state' };
  expect(parseComposeEnvFile(text(env))).toEqual(env);
  expect(() => parseComposeEnvFile(text(valid))).toThrow('env_unknown_key');
  expect(() => parseRuntimeEnvFile(text(env))).toThrow('env_unknown_key');
  for (const value of ['${HOME}/state', '/var/lib/../etc', '/var/lib/a # b', 'relative', '/'])
    expect(() => parseComposeEnvFile(text({ ...env, KWORK_STATE_DIR: value }))).toThrow('env_compose_invalid');
  expect(() => parseComposeEnvFile(text({ ...env, KWORK_RELEASE: 'main' }))).toThrow('env_compose_invalid');
});
it('CLI prints fixed status only for malformed UTF8 and synthetic secret-bearing invalid input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-env-cli-'));
  const path = join(dir, 'synthetic.env');
  const entry = fileURLToPath(new URL('../src/ops/configCheckRun.ts', import.meta.url));
  const loader = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  try {
    for (const content of [Buffer.from([0xff, 0xfe, 0x61]), Buffer.from('synthetic-hidden-key with space=synthetic-hidden-value')]) {
      writeFileSync(path, content, { mode: 0o600 });
      const child = spawnSync(process.execPath, ['--import', loader, entry, '--file', path, 'runtime'], {
        env: {}, encoding: 'utf8', timeout: 5000,
      });
      expect(child.status).toBe(1); expect(child.stdout).toBe('');
      expect(child.stderr.trim()).toBe('env_syntax_invalid');
      expect(child.stderr).not.toContain('synthetic-hidden');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
