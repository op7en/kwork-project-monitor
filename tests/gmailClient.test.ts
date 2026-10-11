import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGmailClient, GMAIL_READONLY_SCOPE, GmailError } from '../src/gmail/client.js';

const api = vi.hoisted(() => ({
  setCredentials: vi.fn(), getAccessToken: vi.fn(), getTokenInfo: vi.fn(),
  getProfile: vi.fn(), list: vi.fn(), get: vi.fn(), gmail: vi.fn(),
}));
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class {
      setCredentials = api.setCredentials;
      getAccessToken = api.getAccessToken;
      getTokenInfo = api.getTokenInfo;
    } },
    gmail: api.gmail,
  },
}));

const config = {
  clientId: 'test-client-id', clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token', expectedAccountEmail: 'owner@example.com',
};
const rawError = new Error('test-client-secret test-refresh-token test-access-token Authorization private@example.com');

beforeEach(() => {
  vi.resetAllMocks();
  api.getAccessToken.mockResolvedValue({ token: 'test-access-token' });
  api.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE] });
  api.getProfile.mockResolvedValue({ data: { emailAddress: 'OWNER@example.com' } });
  api.list.mockResolvedValue({ data: { messages: [{ id: 'message-1' }], nextPageToken: 'page-2' } });
  api.get.mockResolvedValue({ data: {
    id: 'message-1', threadId: 'thread-1', internalDate: '1700000000000',
    payload: { headers: [{ name: 'Subject', value: 'Test subject' }] },
  } });
  api.gmail.mockReturnValue({ users: {
    getProfile: api.getProfile, messages: { list: api.list, get: api.get },
  } });
});

describe('verified readonly Gmail boundary', () => {
  it('checks refresh/access token, actual scopes and account before reading messages', async () => {
    const client = await createGmailClient(config);
    expect(api.setCredentials).toHaveBeenCalledWith({ refresh_token: config.refreshToken });
    expect(api.getTokenInfo).toHaveBeenCalledWith('test-access-token');
    expect(api.getAccessToken.mock.invocationCallOrder[0]).toBeLessThan(api.getTokenInfo.mock.invocationCallOrder[0]!);
    expect(api.getTokenInfo.mock.invocationCallOrder[0]).toBeLessThan(api.getProfile.mock.invocationCallOrder[0]!);
    expect(api.getProfile).toHaveBeenCalledWith({ userId: 'me', fields: 'emailAddress' }, expect.any(Object));
    expect(api.list).not.toHaveBeenCalled();
    await client.listMessages('subject:Test', 10);
    expect(api.getProfile.mock.invocationCallOrder[0]).toBeLessThan(api.list.mock.invocationCallOrder[0]!);
    expect(Object.keys(client).sort()).toEqual(['getMessageMetadata', 'listMessages']);
  });

  it('accepts identity and other non-Gmail scopes in addition to readonly', async () => {
    api.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE, 'openid', 'email', 'profile'] });
    await expect(createGmailClient(config)).resolves.toBeDefined();
  });

  it('permits additional known read-only Gmail permissions', async () => {
    api.getTokenInfo.mockResolvedValue({ scopes: [
      GMAIL_READONLY_SCOPE, 'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
    ] });
    await expect(createGmailClient(config)).resolves.toBeDefined();
  });

  it.each([
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.futurePermission',
  ])('rejects broad or unknown Gmail scope before profile: %s', async (scope) => {
    api.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE, scope, 'openid'] });
    await expect(createGmailClient(config)).rejects.toThrowError(GmailError);
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    { scopes: [] }, { scopes: ['openid', 'email'] },
    { scopes: ['https://www.googleapis.com/auth/gmail.metadata'] },
  ])(
    'requires gmail.readonly: %j', async ({ scopes }) => {
      api.getTokenInfo.mockResolvedValue({ scopes });
      await expect(createGmailClient(config)).rejects.toThrow(/gmail.readonly/);
      expect(api.getProfile).not.toHaveBeenCalled();
    },
  );

  it.each(['different@example.com', undefined])('rejects mismatched/missing account without searching', async (emailAddress) => {
    api.getProfile.mockResolvedValue({ data: { emailAddress } });
    const error = await createGmailClient(config).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GmailError);
    expect(String(error)).not.toContain('@');
    expect(api.list).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('requests metadata only, Subject only and selected fields', async () => {
    const client = await createGmailClient(config);
    await client.getMessageMetadata('message-1');
    expect(api.get).toHaveBeenCalledWith({
      userId: 'me', id: 'message-1', format: 'metadata', metadataHeaders: ['Subject'],
      fields: 'id,threadId,internalDate,payload/headers',
    }, expect.any(Object));
  });

  it.each(['getAccessToken', 'getTokenInfo', 'getProfile', 'list', 'get'] as const)(
    'replaces raw %s failures with safe errors', async (method) => {
      let operation: () => Promise<unknown>;
      if (method === 'list' || method === 'get') {
        const client = await createGmailClient(config);
        operation = () => method === 'list'
          ? client.listMessages('subject:Test', 10) : client.getMessageMetadata('message-1');
      } else operation = () => createGmailClient(config);
      api[method].mockRejectedValue(rawError);
      const error = await operation().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GmailError);
      for (const secret of ['test-client-secret', 'test-refresh-token', 'test-access-token', 'Authorization', '@']) {
        expect(String(error)).not.toContain(secret);
      }
      expect(error).not.toHaveProperty('cause');
    },
  );

  it('fails safely if OAuth returns no access token', async () => {
    api.getAccessToken.mockResolvedValue({ token: null });
    await expect(createGmailClient(config)).rejects.toThrowError(GmailError);
    expect(api.getTokenInfo).not.toHaveBeenCalled();
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'getAccessToken', stage: 'access_token' },
    { method: 'getTokenInfo', stage: 'oauth_scopes' },
    { method: 'getProfile', stage: 'profile' },
    { method: 'list', stage: 'messages_list' },
    { method: 'get', stage: 'message_metadata' },
  ] as const)('identifies the failing $stage boundary without retaining raw errors', async ({ method, stage }) => {
    const client = method === 'list' || method === 'get' ? await createGmailClient(config) : undefined;
    api[method].mockRejectedValue({
      response: { status: 400, data: { error: 'invalid_grant', error_description: 'synthetic-secret' } },
      config: { headers: { Authorization: 'synthetic-secret' }, url: 'https://example.com/synthetic-secret' },
    });
    const operation = method === 'list' ? client!.listMessages('subject:Test', 10)
      : method === 'get' ? client!.getMessageMetadata('message-1') : createGmailClient(config);
    const error: unknown = await operation.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ stage, category: 'invalid_grant', httpStatus: 400 });
    expect(JSON.stringify(error)).not.toMatch(/synthetic-secret|Authorization|https:/);
    expect(error).not.toHaveProperty('cause');
    if (method === 'getAccessToken') expect(api.getTokenInfo).not.toHaveBeenCalled();
    if (method === 'getAccessToken' || method === 'getTokenInfo') expect(api.getProfile).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'invalid_grant', expected: 'invalid_grant' },
    { code: 'invalid_client', expected: 'invalid_client' },
    { code: 'access_denied', expected: 'access_denied' },
    { code: 'insufficient_scope', expected: 'insufficient_scope' },
    { code: 'synthetic-secret', expected: 'unknown_oauth_error' },
  ])('only exposes allowlisted OAuth error categories: $expected', async ({ code, expected }) => {
    api.getAccessToken.mockRejectedValue({ response: { status: 401, data: { error: code } } });
    const error: unknown = await createGmailClient(config).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ stage: 'access_token', category: expected, httpStatus: 401 });
    expect(JSON.stringify(error)).not.toContain('synthetic-secret');
  });

  it.each([
    { raw: { code: 'ENOTFOUND' }, category: 'network_error' },
    { raw: { cause: { code: 'ECONNRESET' } }, category: 'network_error' },
    { raw: { code: 'ETIMEDOUT' }, category: 'timeout' },
    { raw: { name: 'TimeoutError' }, category: 'timeout' },
    { raw: { name: 'AbortError' }, category: 'timeout' },
    { raw: { message: 'invalid_grant synthetic-secret', code: 'synthetic-secret' }, category: 'unknown_oauth_error' },
    { raw: null, category: 'unknown_oauth_error' },
  ])('classifies transport errors without parsing raw messages: $category', async ({ raw, category }) => {
    api.getAccessToken.mockRejectedValue(raw);
    const error: unknown = await createGmailClient(config).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ stage: 'access_token', category });
    expect(error).not.toHaveProperty('httpStatus');
    expect(JSON.stringify(error)).not.toContain('synthetic-secret');
  });

  it.each([NaN, 99, 600, 400.5, '400', 'synthetic-secret'])(
    'does not copy invalid HTTP status %j', async (status) => {
      api.getAccessToken.mockRejectedValue({ response: { status, data: { error: 'invalid_grant' } } });
      const error: unknown = await createGmailClient(config).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ category: 'invalid_grant' });
      expect(error).not.toHaveProperty('httpStatus');
    },
  );

  it('identifies a rejected scope before profile access', async () => {
    api.getTokenInfo.mockResolvedValue({ scopes: ['openid'] });
    await expect(createGmailClient(config)).rejects.toMatchObject({ stage: 'oauth_scopes', category: 'insufficient_scope' });
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it('identifies a wrong account without exposing either email', async () => {
    api.getProfile.mockResolvedValue({ data: { emailAddress: 'different@example.com' } });
    const error: unknown = await createGmailClient(config).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ stage: 'account', category: 'account_mismatch' });
    expect(JSON.stringify(error)).not.toContain('@');
    expect(api.list).not.toHaveBeenCalled();
  });
});
