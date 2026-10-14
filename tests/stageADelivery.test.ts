import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Api } from 'grammy';
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectNotifier } from '../src/bot/projectNotifications.js';
import { formatProjectNotification } from '../src/bot/projectFormatter.js';
import { classifyProject } from '../src/filters/projectFilter.js';
import type { GmailFullMessage } from '../src/gmail/client.js';
import { parseGmailMessage } from '../src/gmail/projects.js';
import type { KworkProject } from '../src/kwork/model.js';
import { KWORK_TABLE_POLICY } from '../src/kwork/parser.js';
import { createMonitoringPass } from '../src/monitor/pass.js';
import { createMonitorController, type MonitorController } from '../src/monitor/controller.js';
import { MonitorStore } from '../src/monitor/store.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';

const stores: MonitorStore[] = [], dirs: string[] = [], controllers: MonitorController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.shutdown();
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const project = (title: string): KworkProject => ({ projectId: '9000001', title,
  url: 'https://kwork.ru/new_offer?project=9000001', sourceGmailMessageId: 'synthetic-a' });
const row = (id = '9000001', title = 'Исправить React баг') => TABLE_ROW
  .replaceAll('9000001', id).replace('Синтетический интерфейс', title);
const message = (rows: string, style?: string): GmailFullMessage => ({ id: 'synthetic-a', payload: {
  mimeType: 'text/html', body: { data: Buffer.from((style ? `<div style="${style}">` : '') +
    `<table>${TABLE_HEADER}${rows}</table>` + (style ? '</div>' : '')).toString('base64url') },
} });
function setup(messages: GmailFullMessage[], failSend = false, maxSends = 10) {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-stage-a-')); dirs.push(dir);
  const path = join(dir, 'state.sqlite');
  const store = new MonitorStore(path, 'synthetic-binding'); stores.push(store); store.baseline('100', 1000);
  const cards: { text: string; chatId: number }[] = [];
  const api = new Api('test-only-placeholder');
  api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage' || !('text' in payload) || !('chat_id' in payload))
      throw Error('Unexpected mock Telegram method');
    cards.push({ text: payload.text, chatId: Number(payload.chat_id) });
    if (failSend) return Promise.reject(Error('synthetic-transport-failure'));
    return Promise.resolve({ ok: true, result: { message_id: 1, date: 0,
      chat: { id: 123, type: 'private', first_name: 'Synthetic' }, text: payload.text } }) as ReturnType<typeof previous<typeof method>>;
  });
  const notifier = createProjectNotifier(api, 123);
  notifier.confirmDestination({ from: { id: 123, is_bot: false, first_name: 'Synthetic' },
    chat: { id: 123, type: 'private', first_name: 'Synthetic' } });
  const read = vi.fn(async (id: string) => ({ message: messages.find(item => item.id === id)!, diagnostics: [] }));
  const connect = async () => ({ currentHistoryId: async () => '300',
    historyPage: async () => ({ historyId: '300', records: [{ historyId: '200', messageIds: messages.map(item => item.id!) }] }),
    checkMessageMetadata: async () => true, reader: { getProjectMessage: read } });
  const makePass = (ledger: MonitorStore) => createMonitoringPass({ store: ledger, notifier, connect,
    limits: { maxPages: 10, maxMessages: 100, maxProjects: 200, maxSends } });
  return { store, path, cards, read, pass: makePass(store), makePass };
}

it.each([
  [{ kind: 'fixed', amount: 5000 }, '5 000 ₽'],
  [{ kind: 'up-to', max: 10000 }, 'до 10 000 ₽'],
  [{ kind: 'from', min: 5000 }, 'от 5 000 ₽'],
  [{ kind: 'range', min: 8000, max: 12000 }, '8 000–12 000 ₽'],
] as const)(
  'preserves and displays the table price %j', (value, text) => {
    const parsed = parseGmailMessage(message(row().replace('5 555 ₽', text)), KWORK_TABLE_POLICY);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.projects[0]?.price).toEqual({ ...value, raw: text, currency: 'RUB' });
    expect(formatProjectNotification(parsed.projects[0]!)?.text).toContain(`Цена: ${text}`);
  });

it.each([
  { kind: 'fixed', amount: 1000 }, { kind: 'up-to', max: 1000 }, { kind: 'range', min: 500, max: 1000 },
] as const)('flags a provably low price for complex scope: %j', value => {
  const decision = classifyProject({ ...project('React: большой магазин с нуля'),
    price: { ...value, raw: 'synthetic', currency: 'RUB' } });
  expect(decision.reasons).toContain('scope_budget_caution');
});
it.each([
  { kind: 'from', min: 1000 }, { kind: 'fixed', amount: 20000 },
  { kind: 'up-to', max: 20000 }, { kind: 'range', min: 500, max: 30000 },
] as const)('does not infer a low ceiling from %j', value => {
  expect(classifyProject({ ...project('React: большой магазин с нуля'),
    price: { ...value, raw: 'synthetic', currency: 'RUB' } }).reasons).not.toContain('scope_budget_caution');
});
it.each(['Сделать сайт React', 'Создать React приложение', 'Разработать React лендинг',
  'Написать Node.js парсер', 'Настроить PostgreSQL базу данных', 'Подключить React API',
  'Node.js backend deploy', 'React frontend landing'])('recognizes common development tasks: %s', title => {
  expect(classifyProject(project(title)).classification).toBe('match');
});
it.each(['Написать Telegram бот', 'Python parser'])('delivers auxiliary tasks without invented small scope: %s', title => {
  expect(classifyProject(project(title))).toEqual({ classification: 'review', reasons: ['insufficient_evidence'] });
});

it.each(['color:red; broken fragment', 'display:var(--unknown)', 'visibility:unknown'])(
  'preserves the project table under uncertain CSS: %s', style => {
    expect(parseGmailMessage(message(row(), style), KWORK_TABLE_POLICY).projects).toHaveLength(1);
  });
it.each(['display:none', 'visibility:hidden', 'visibility:collapse', 'mso-hide:all'])(
  'does not extract projects from proven hidden content: %s', style => {
    expect(parseGmailMessage(message(row(), style), KWORK_TABLE_POLICY).projects).toEqual([]);
  });
it.each([
  '<tr><td>synthetic malformed row</td></tr>',
  row('9000002').replace('https://kwork.ru/new_offer?project=9000002', 'https://example.invalid/project'),
  row('9000002').replace('5 555 ₽', 'unknown'),
  row(),
])('delivers valid rows despite a local row issue %#', async extra => {
  const s = setup([message(row() + extra)]);
  const result = await s.pass.run();
  expect(result).toMatchObject({ status: 'completed', parseFailed: 0, sent: extra.includes('unknown') ? 2 : 1 });
  expect(s.store.cursor()?.historyId).toBe('300');
  await s.pass.run(); expect(s.read).toHaveBeenCalledTimes(1);
});
it('retains fatal MIME failure even alongside a valid parsed table', async () => {
  const valid = message(row());
  const mixed: GmailFullMessage = { id: 'synthetic-a', payload: { mimeType: 'multipart/mixed',
    parts: [valid.payload!, { mimeType: 'text/html', body: { data: 'invalid*' } }] } };
  expect(parseGmailMessage(mixed, KWORK_TABLE_POLICY).projects).toHaveLength(1);
  const s = setup([mixed]);
  expect(await s.pass.run()).toMatchObject({ parseFailed: 1, sent: 0 }); expect(s.cards).toEqual([]);
});
it('records an empty selection as terminal parse failure', async () => {
  const s = setup([message('<tr><td>synthetic invalid row</td></tr>')]);
  expect(await s.pass.run()).toMatchObject({ parseFailed: 1, sent: 0 });
  expect(s.store.hasMessage('synthetic-a')).toBe(true);
});
it('sends review with Russian reasons and keeps exclusion and dedup across restart', async () => {
  const messages = [message(row('9000001', 'Написать Telegram бот') + row('9000002', 'WordPress сайт'))];
  const s = setup(messages);
  expect(await s.pass.run()).toMatchObject({ review: 1, exclude: 1, sent: 1 });
  expect(s.cards).toHaveLength(1); expect(s.cards[0]).toMatchObject({ chatId: 123 });
  expect(s.cards[0]?.text).toContain('Статус: На проверку (Недостаточно данных)');
  expect(s.store.counts()).toMatchObject({ filtered: 1, sent: 1 });
  s.store.close(); const reopened = new MonitorStore(s.path, 'synthetic-binding'); stores.push(reopened);
  messages.push({ ...message(row('9000001', 'Написать Telegram бот')), id: 'synthetic-b' });
  reopened.baseline('100', 1000, true);
  expect(await s.makePass(reopened).run()).toMatchObject({ sent: 0 });
  expect(reopened.hasMessage('synthetic-b')).toBe(true);
  expect(s.cards).toHaveLength(1);
});
it('keeps review delivery_unknown terminal after ambiguous transport failure', async () => {
  const messages = [message(row('9000001', 'Написать Telegram бот'))];
  const s = setup(messages, true);
  expect(await s.pass.run()).toMatchObject({ unknown: 1, sent: 0 });
  messages.push({ ...message(row('9000001', 'Написать Telegram бот')), id: 'synthetic-b' });
  s.store.baseline('100', 1000, true);
  expect(await s.pass.run()).toMatchObject({ sent: 0, unknown: 0 });
  expect(s.cards).toHaveLength(1); expect(s.store.counts().delivery_unknown).toBe(1);
});
it('reserves review before delivery and never retries an orphan reservation after reopen', async () => {
  const s = setup([message(row('9000001', 'Написать Telegram бот'))]);
  expect(s.store.recordMessage('synthetic-other', 'parsed', [{ projectId: '9000001', classification: 'review',
    reasons: ['insufficient_evidence'] }])).toEqual(['9000001']);
  expect(s.store.counts().reserved).toBe(1);
  s.store.close(); const reopened = new MonitorStore(s.path, 'synthetic-binding'); stores.push(reopened);
  expect(reopened.counts()).toMatchObject({ delivery_unknown: 1, reserved: 0 });
  expect(await s.makePass(reopened).run()).toMatchObject({ sent: 0 }); expect(s.cards).toEqual([]);
});
it('completes a large digest and defers the next body without pausing the controller', async () => {
  const rows = Array.from({ length: 11 }, (_, index) => row(String(9000001 + index), 'Написать Telegram бот')).join('');
  const s = setup([message(rows), { ...message(row('9000020')), id: 'synthetic-b' }]);
  const controller = createMonitorController({ hasConfirmedDestination: () => true, restoreConfirmedDestination() {}, sendAlert: async () => true },
    () => ({ store: s.store, pass: s.pass }), 60_000); controllers.push(controller);
  expect(await controller.on()).toMatchObject({ status: 'partial', review: 11, sent: 11 });
  expect(controller.status()).toMatchObject({ enabled: true, blocked: false });
  expect(s.read.mock.calls.map(([id]) => id)).toEqual(['synthetic-a']);
  expect(s.store.hasMessage('synthetic-b')).toBe(false); expect(s.store.hasProject('9000020')).toBe(false);
  expect(s.store.cursor()?.historyId).toBe('100');
  expect(await controller.run()).toMatchObject({ status: 'completed', sent: 1 });
  expect(s.cards).toHaveLength(12); expect(s.store.cursor()?.historyId).toBe('300');
});
it('finishes a final digest exceeding the soft limit without a redundant partial pass', async () => {
  const s = setup([message(row() + row('9000002'))], false, 1);
  expect(await s.pass.run()).toMatchObject({ status: 'completed', sent: 2 });
  expect(s.store.cursor()?.historyId).toBe('300');
});
it('rejects oversized tables without sending a truncated selection', async () => {
  const s = setup([message(row().repeat(101))]);
  expect(await s.pass.run()).toMatchObject({ parseFailed: 1, sent: 0 });
  expect(s.cards).toEqual([]);
});
