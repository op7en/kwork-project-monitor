import { beforeEach, expect, it, vi } from 'vitest';
import { createGmailMonitoringClient } from '../src/gmail/client.js';
const api = vi.hoisted(() => ({ token: vi.fn(), scopes: vi.fn(), profile: vi.fn(), history: vi.fn(), get: vi.fn() }));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {
  setCredentials() {} getAccessToken = api.token; getTokenInfo = api.scopes;
} }, gmail: () => ({ users: { getProfile: api.profile, history: { list: api.history }, messages: { get: api.get } } }) } }));
const config = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', expectedAccountEmail: 'owner@example.invalid' };
const metadata = (internalDate = '2000', sender = 'news@kwork.ru') => ({ data: { id: 'synthetic-message',
  internalDate, sizeEstimate: 100, payload: { headers: [{ name: 'Subject', value: 'Новые проекты на бирже Kwork' }, { name: 'From', value: sender }] } } });
beforeEach(() => {
  vi.resetAllMocks(); api.token.mockResolvedValue({ token: 'synthetic-access' });
  api.scopes.mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
  api.profile.mockResolvedValue({ data: { emailAddress: 'owner@example.invalid', historyId: '300' } });
  api.history.mockResolvedValue({ data: { historyId: '300', history: [{ id: '200', messagesAdded: [{ message: { id: 'synthetic-message' } }] }] } });
  api.get.mockResolvedValue(metadata());
});
it('reuses scope/account checks and asks only for additions with narrow history fields', async () => {
  const client = await createGmailMonitoringClient(config, 1000);
  expect(await client.currentHistoryId()).toBe('300');
  expect(await client.historyPage('100')).toEqual({ historyId: '300', records: [{ historyId: '200', messageIds: ['synthetic-message'] }] });
  expect(api.history.mock.calls[0]?.[0]).toMatchObject({ userId: 'me', startHistoryId: '100', historyTypes: ['messageAdded'], maxResults: 100 });
  expect(api.get).not.toHaveBeenCalled();
});
it.each(['scope', 'account'])('refuses %s mismatch before discovery or body', async kind => {
  if (kind === 'scope') api.scopes.mockResolvedValue({ scopes: ['https://mail.google.com/'] });
  else api.profile.mockResolvedValue({ data: { emailAddress: 'other@example.invalid' } });
  await expect(createGmailMonitoringClient(config, 1000)).rejects.toThrow();
  expect(api.history).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
});
it.each([['500', 'news@kwork.ru', 'historical_message'], ['2000', 'other@example.invalid', 'message_rejected'],
  ['bad', 'news@kwork.ru', 'message_rejected']] as const)('rejects metadata %s/%s before body', async (date, sender, diagnostic) => {
  const client = await createGmailMonitoringClient(config, 1000);
  api.get.mockResolvedValue(metadata(date, sender));
  expect((await client.reader.getProjectMessage('synthetic-message')).diagnostics).toEqual([diagnostic]);
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata']);
});
it('accepts the exact activation timestamp and checks stop between metadata and full', async () => {
  let allowed = true; const client = await createGmailMonitoringClient(config, 1000, () => allowed);
  api.get.mockImplementation(async () => { allowed = false; return metadata('1000'); });
  expect((await client.reader.getProjectMessage('synthetic-message')).diagnostics).toEqual(['operation_cancelled']);
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata']);
});
it('rejects an invalid activation floor before OAuth or mailbox access', async () => {
  await expect(createGmailMonitoringClient(config, NaN)).rejects.toThrow();
  expect(api.token).not.toHaveBeenCalled();
});
it('stops OAuth setup between token and scopes without starting further requests', async () => {
  let allowed = true;
  api.token.mockImplementation(async () => { allowed = false; return { token: 'synthetic-access' }; });
  await expect(createGmailMonitoringClient(config, 1000, () => allowed)).rejects.toThrow();
  expect(api.scopes).not.toHaveBeenCalled(); expect(api.profile).not.toHaveBeenCalled();
});
it('stops OAuth setup between scopes and profile without starting a profile request', async () => {
  let allowed = true;
  api.scopes.mockImplementation(async () => { allowed = false; return { scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }; });
  await expect(createGmailMonitoringClient(config, 1000, () => allowed)).rejects.toThrow();
  expect(api.profile).not.toHaveBeenCalled();
});
it('rechecks cancellation after asynchronous API module loading before the first token request', async () => {
  let allowed = true;
  const pending = createGmailMonitoringClient(config, 1000, () => allowed);
  allowed = false;
  await expect(pending).rejects.toThrow();
  expect(api.token).not.toHaveBeenCalled();
});
