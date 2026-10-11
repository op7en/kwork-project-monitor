import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGmailCheck } from '../src/gmail/smokeCheck.js';
import { GmailError } from '../src/gmail/client.js';
import { ConfigError } from '../src/config/env.js';

const boundary = vi.hoisted(() => ({ loadConfig: vi.fn(), createClient: vi.fn(), findEmails: vi.fn() }));
vi.mock('../src/config/gmail.js', () => ({ loadGmailConfig: boundary.loadConfig }));
vi.mock('../src/gmail/client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/gmail/client.js')>(),
  createGmailClient: boundary.createClient,
}));
vi.mock('../src/gmail/kworkEmails.js', () => ({ findKworkEmails: boundary.findEmails }));

beforeEach(() => {
  vi.resetAllMocks();
  boundary.loadConfig.mockReturnValue({});
  boundary.createClient.mockResolvedValue({});
  boundary.findEmails.mockResolvedValue([{ id: 'test-id-not-to-log' }]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Gmail smoke check output without network', () => {
  it('prints only status and match count with fake API dependencies', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await runGmailCheck()).toBe(0);
    expect(info.mock.calls).toEqual([
      ['Gmail connection: OK'], ['Account: verified'], ['Matching Kwork emails: 1'],
    ]);
  });

  it('does not log raw unexpected errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    boundary.createClient.mockRejectedValue(new Error('synthetic-credential private@example.com Authorization'));
    expect(await runGmailCheck()).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(error.mock.calls);
    expect(output).not.toMatch(/synthetic-credential|private@example.com|Authorization/);
  });

  it.each(['access_token', 'oauth_scopes', 'profile', 'account', 'messages_list', 'message_metadata'] as const)(
    'prints only safe diagnostic fields for %s failures', async (stage) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new GmailError('synthetic-credential private@example.com Authorization', stage, 'invalid_grant', 400);
      if (stage === 'messages_list' || stage === 'message_metadata') boundary.findEmails.mockRejectedValue(failure);
      else boundary.createClient.mockRejectedValue(failure);
      expect(await runGmailCheck()).toBe(1);
      expect(error.mock.calls).toEqual([
        [`Gmail check failed: stage=${stage}; category=invalid_grant; http_status=400`],
      ]);
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/synthetic-credential|private@example.com|Authorization/);
    },
  );

  it('identifies configuration validation before creating the OAuth client', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    boundary.loadConfig.mockImplementation(() => { throw new ConfigError('GMAIL_CLIENT_ID отсутствует.'); });
    expect(await runGmailCheck()).toBe(1);
    expect(error.mock.calls[0]?.[0]).toContain('stage=configuration; category=configuration_error');
    expect(error.mock.calls[0]?.[0]).toContain('GMAIL_CLIENT_ID');
    expect(boundary.createClient).not.toHaveBeenCalled();
  });

  it('exits before network when Gmail config is absent, without loading any env file', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/gmail/check.ts'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env: {}, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GMAIL_CLIENT_ID');
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(/client_secret|refresh_token|Authorization/);
  });
});
