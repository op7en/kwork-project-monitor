import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { createMonitorController, type MonitorController } from '../src/monitor/controller.js';
import { createMonitoringPass } from '../src/monitor/pass.js';
import { MonitorStore } from '../src/monitor/store.js';
import { createGmailMonitoringClient } from '../src/gmail/client.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';
import type { Update, UserFromGetMe } from 'grammy/types';
const api = vi.hoisted(() => ({ token: vi.fn(), scopes: vi.fn(), profile: vi.fn(), history: vi.fn(), get: vi.fn() }));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {
  setCredentials() {} getAccessToken = api.token; getTokenInfo = api.scopes;
} }, gmail: () => ({ users: { getProfile: api.profile, history: { list: api.history }, messages: { get: api.get } } }) } }));
const config = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', refreshToken: 'synthetic-refresh', expectedAccountEmail: 'owner@example.invalid' };
const owner = 7654321, controllers: MonitorController[] = [], dirs: string[] = [];
let cursor = '100', messageId = 'synthetic-a', sender = 'news@kwork.ru';
beforeEach(() => {
  vi.resetAllMocks(); cursor = '100'; messageId = 'synthetic-a'; sender = 'news@kwork.ru';
  api.token.mockResolvedValue({ token: 'synthetic-access' });
  api.scopes.mockResolvedValue({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
  api.profile.mockImplementation(async () => ({ data: { emailAddress: 'owner@example.invalid', historyId: cursor } }));
  api.history.mockImplementation(async () => ({ data: { historyId: cursor,
    history: [{ id: cursor, messagesAdded: [{ message: { id: messageId } }] }] } }));
  api.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => ({ data: { id, internalDate: '2000', sizeEstimate: 10000,
    payload: { headers: [{ name: 'Subject', value: 'Новые проекты на бирже Kwork' }, { name: 'From', value: sender }],
      ...(format === 'full' ? { mimeType: 'text/html', body: { data: Buffer.from('<table>' + TABLE_HEADER +
        TABLE_ROW.replace('Синтетический интерфейс', 'Исправить React баг') + '</table>').toString('base64url') } } : {}) } } }));
});
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.shutdown();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});
function setup(path?: string, failSend = false) {
  vi.useFakeTimers();
  if (!path) { const dir = mkdtempSync(join(tmpdir(), 'kwork-flow-')); dirs.push(dir); path = join(dir, 'state.sqlite'); }
  let monitor!: MonitorController;
  const bot = createBot('test-only-placeholder', owner, undefined, notifier => {
    monitor = createMonitorController(notifier, () => {
      const store = new MonitorStore(path!, 'synthetic-binding');
      return { store, pass: createMonitoringPass({ store, notifier, now: () => 1000,
        connect: (floor, allowed) => createGmailMonitoringClient(config, floor, allowed) }) };
    }, 1000);
    controllers.push(monitor); return monitor;
  });
  bot.botInfo = { id: 9001, is_bot: true, first_name: 'Synthetic', username: 'test_monitor' } as UserFromGetMe;
  const cards: unknown[] = [], texts: string[] = [];
  bot.api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage') throw Error('Unexpected mock Telegram call');
    if ('text' in payload) texts.push(payload.text);
    if ('reply_markup' in payload && payload.reply_markup) {
      cards.push(payload);
      if (failSend) return Promise.reject(new Error('SYNTHETIC_PRIVATE_URL_TOKEN'));
    }
    return Promise.resolve({ ok: true, result: { message_id: 2, date: 0,
      chat: { id: owner, type: 'private', first_name: 'Synthetic' } } }) as ReturnType<typeof previous<typeof method>>;
  });
  const command = async (text: string) => {
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0,
    from: { id: owner, is_bot: false, first_name: 'Synthetic' }, chat: { id: owner, type: 'private', first_name: 'Synthetic' },
      text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } } as Update);
    await vi.waitFor(() => expect(monitor.status().running).toBe(false));
  };
  return { bot, monitor, cards, texts, command, path };
}
it('runs owner command through verified Gmail, metadata gate, parser, SQLite and notifier across restart', async () => {
  const s = setup(); await s.command('/monitor on'); expect(api.get).not.toHaveBeenCalled(); expect(s.cards).toEqual([]);
  cursor = '200'; await s.command('/projects');
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata', 'full']); expect(s.cards).toHaveLength(1);
  expect(s.cards[0]).toMatchObject({ chat_id: owner, reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ',
    url: 'https://kwork.ru/new_offer?project=9000001' }]] } });
  await s.command('/projects'); expect(s.cards).toHaveLength(1);
  await s.monitor.shutdown(); const restarted = setup(s.path);
  await restarted.command('/projects'); expect(restarted.cards).toEqual([]);
  await restarted.command('/monitor on'); cursor = '300'; messageId = 'synthetic-b'; await restarted.command('/projects');
  expect(restarted.cards).toEqual([]); expect(restarted.monitor.status().counts.sent).toBe(1);
  expect(JSON.stringify([...s.texts, ...restarted.texts])).not.toContain('synthetic-a');
});
it('does not fetch a body for an invalid sender and stops on expired history instead of historical search', async () => {
  const s = setup(); await s.command('/monitor on'); cursor = '200'; sender = 'other@example.invalid';
  await s.command('/projects'); expect(api.get.mock.calls.map(c => c[0].format)).toEqual(['metadata']); expect(s.cards).toEqual([]);
  cursor = '300'; api.history.mockRejectedValue({ response: { status: 404, data: 'SYNTHETIC_PRIVATE' } });
  await s.command('/projects'); expect(s.monitor.status()).toMatchObject({ enabled: false, lastStatus: 'history_expired' });
  await vi.advanceTimersByTimeAsync(5000); expect(api.history).toHaveBeenCalledTimes(2);
  await s.command('/monitor baseline'); expect(s.monitor.status()).toMatchObject({ enabled: false, lastStatus: 'baseline_exists', blocked: true });
  await s.command('/monitor baseline confirm'); expect(s.monitor.status()).toMatchObject({ enabled: false, lastStatus: 'initialized', blocked: false });
  expect(JSON.stringify(s.texts)).not.toContain('SYNTHETIC_PRIVATE');
});
it('persists an ambiguous Telegram outcome and never retries that project', async () => {
  const s = setup(undefined, true); await s.command('/monitor on'); cursor = '200'; await s.command('/projects');
  expect(s.monitor.status().counts.delivery_unknown).toBe(1);
  cursor = '300'; messageId = 'synthetic-b'; await s.command('/projects'); expect(s.cards).toHaveLength(1);
  expect(JSON.stringify(s.texts)).not.toContain('SYNTHETIC_PRIVATE');
});
it('pauses a permanent account permission failure instead of retrying it every interval', async () => {
  const s = setup();
  api.profile.mockResolvedValue({ data: { emailAddress: 'different@example.invalid' } });
  await s.command('/monitor on');
  expect(s.monitor.status()).toMatchObject({ enabled: false, lastStatus: 'gmail_access_error' });
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.token).toHaveBeenCalledTimes(1); expect(api.get).not.toHaveBeenCalled(); expect(s.cards).toEqual([]);
});
it.each(['metadata', 'full'])('pauses reader permission failure at %s without retrying later scheduled operations', async format => {
  const s = setup(); await s.command('/monitor on'); cursor = '200';
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async args => {
    if (args.format === format) throw { response: { status: 403 } };
    return original(args);
  });
  await s.command('/projects');
  expect(s.monitor.status()).toMatchObject({ enabled: false, blocked: true, lastStatus: 'gmail_access_error', counts: { messages: 0 } });
  const calls = api.get.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(api.get).toHaveBeenCalledTimes(calls);
  expect(s.cards).toEqual([]);
});
it('off drains an already-started send and prevents the next project and timer after completion', async () => {
  const s = setup(); await s.command('/monitor on'); cursor = '200';
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async args => {
    const response = await original(args);
    if (args.format === 'full') response.data.payload.body!.data = Buffer.from('<table>' + TABLE_HEADER +
      TABLE_ROW.replace('Синтетический интерфейс', 'Исправить React баг') +
      TABLE_ROW.replaceAll('9000001', '9000002').replace('Синтетический интерфейс', 'Исправить React баг') + '</table>').toString('base64url');
    return response;
  });
  let release!: () => void;
  s.bot.api.config.use(async (previous, method, payload, signal) => {
    if (method === 'sendMessage' && 'reply_markup' in payload && payload.reply_markup)
      await new Promise<void>(resolve => { release = resolve; });
    return previous(method, payload, signal);
  });
  const running = s.monitor.run();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let offFinished = false; const stopping = s.monitor.off().then(() => { offFinished = true; });
  await Promise.resolve(); expect(offFinished).toBe(false);
  expect(s.monitor.status()).toMatchObject({ enabled: false, running: true });
  release(); await running; await stopping;
  expect(offFinished).toBe(true); expect(s.cards).toHaveLength(1);
  expect(s.monitor.status().counts).toMatchObject({ sent: 1, delivery_unknown: 1, reserved: 0 });
  await vi.advanceTimersByTimeAsync(5000); expect(s.cards).toHaveLength(1);
});
it.each(['token', 'pagination', 'metadata', 'full'] as const)('off during %s drains that request without starting another operation or send', async stage => {
  const s = setup(); await s.command('/monitor on'); cursor = '200';
  let release!: () => void, started = false;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const target = stage === 'token' ? api.token : stage === 'pagination' ? api.history : api.get;
  const original = target.getMockImplementation()!;
  target.mockImplementation(async (...args) => {
    if (stage === 'token' || stage === 'pagination' || args[0].format === stage) { started = true; await wait; }
    return original(...args);
  });
  const running = s.monitor.run(); await vi.waitFor(() => expect(started).toBe(true));
  const stopping = s.monitor.off(); expect(s.monitor.status()).toMatchObject({ enabled: false, running: true });
  release(); expect((await running).status).toBe('stopped'); await stopping;
  expect(s.cards).toEqual([]); expect(s.monitor.status().counts.messages).toBe(0);
  expect(api.get.mock.calls.map(c => c[0].format)).toEqual(stage === 'metadata' ? ['metadata'] : stage === 'full' ? ['metadata', 'full'] : []);
  const requests = api.token.mock.calls.length + api.scopes.mock.calls.length + api.profile.mock.calls.length + api.history.mock.calls.length + api.get.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.token.mock.calls.length + api.scopes.mock.calls.length + api.profile.mock.calls.length + api.history.mock.calls.length + api.get.mock.calls.length).toBe(requests);
});
