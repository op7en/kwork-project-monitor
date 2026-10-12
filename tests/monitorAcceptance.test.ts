import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { MonitorStore } from '../src/monitor/store.js';
import { createAcceptancePass } from '../src/monitor/acceptance.js';
import { createAcceptanceBot } from '../src/monitor/acceptanceBot.js';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { MonitoringGmail } from '../src/gmail/monitorClient.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';
const dirs: string[] = [], stores: MonitorStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup(ids = ['synthetic-selected'], rows = TABLE_ROW) {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-acceptance-')); dirs.push(dir);
  const store = new MonitorStore(join(dir, 'state.sqlite'), 'synthetic'); stores.push(store); store.baseline('100', 1000);
  const read = vi.fn<MonitoringGmail['reader']['getProjectMessage']>(async id => ({ diagnostics: [], message: { id,
    payload: { mimeType: 'text/html', body: { data: Buffer.from('<table>' + TABLE_HEADER +
      rows.replaceAll('Синтетический интерфейс', 'Исправить React баг') + '</table>').toString('base64url') } } } }));
  const client: MonitoringGmail = { currentHistoryId: async () => '300',
    historyPage: async () => ({ historyId: '300', records: [{ historyId: '200', messageIds: ids }] }), reader: { getProjectMessage: read } };
  const notifier = { hasConfirmedDestination: () => true, send: vi.fn(async () => ({ status: 'sent' as const })) };
  const connect = vi.fn(async () => client);
  const pass = createAcceptancePass({ store, notifier, connect }, 'synthetic-selected');
  return { store, read, notifier, connect, pass };
}
it('reserves the entire acceptance run synchronously and shares the global persistent ledger', async () => {
  const s = setup(); const first = s.pass.run();
  expect((await s.pass.run()).status).toBe('acceptance_used');
  expect(await first).toMatchObject({ status: 'completed', sent: 1 });
  expect((await s.pass.run()).status).toBe('acceptance_used');
  expect(s.read).toHaveBeenCalledTimes(1); expect(s.notifier.send).toHaveBeenCalledTimes(1);
  expect(s.store.counts()).toMatchObject({ messages: 1, sent: 1, reserved: 0 });
});
it.each([['synthetic-other'], ['synthetic-selected', 'synthetic-other']])('aborts unselected or multiple messages before any body (%s)', async (...ids) => {
  const s = setup(ids); const result = await s.pass.run();
  expect(['acceptance_rejected', 'discovery_overflow']).toContain(result.status);
  expect(s.read).not.toHaveBeenCalled(); expect(s.notifier.send).not.toHaveBeenCalled();
  expect(s.store.cursor()?.historyId).toBe('100');
});
it('does not pick one card from a multi-project message', async () => {
  const s = setup(undefined, TABLE_ROW + TABLE_ROW.replaceAll('9000001', '9000002'));
  expect((await s.pass.run()).status).toBe('acceptance_rejected');
  expect(s.read).toHaveBeenCalledTimes(1); expect(s.notifier.send).not.toHaveBeenCalled();
  expect(s.store.counts().messages).toBe(0);
});
it('never retries a read or an ambiguous send in the acceptance run', async () => {
  const failedRead = setup(); failedRead.read.mockRejectedValue(Error('synthetic-private'));
  expect((await failedRead.pass.run()).status).toBe('partial'); await failedRead.pass.run();
  expect(failedRead.read).toHaveBeenCalledTimes(1); expect(failedRead.notifier.send).not.toHaveBeenCalled();
  const failedSend = setup(); failedSend.notifier.send.mockRejectedValue(Error('synthetic-private'));
  expect(await failedSend.pass.run()).toMatchObject({ unknown: 1, sent: 0 }); await failedSend.pass.run();
  expect(failedSend.notifier.send).toHaveBeenCalledTimes(1); expect(failedSend.store.counts().delivery_unknown).toBe(1);
});
it('does not bypass an existing project tombstone or unconfirmed destination', async () => {
  const s = setup(); s.store.recordMessage('synthetic-old', 'parsed', [{ projectId: '9000001', classification: 'match', reasons: ['stack_and_task'] }]);
  s.store.settle('9000001', 'delivery_unknown');
  await s.pass.run(); expect(s.notifier.send).not.toHaveBeenCalled();
  const unconfirmed = setup(); unconfirmed.notifier.hasConfirmedDestination = () => false;
  expect((await unconfirmed.pass.run()).status).toBe('destination_unconfirmed'); expect(unconfirmed.connect).not.toHaveBeenCalled();
});
it('requires a genuine owner-private update and sends no technical replies or second card', async () => {
  const s = setup(), owner = 7654321, results: unknown[] = [];
  const create = vi.fn((notifier: Parameters<typeof createAcceptanceBot>[2] extends (n: infer N) => unknown ? N : never) =>
    ({ store: s.store, pass: createAcceptancePass({ store: s.store, notifier, connect: s.connect }, 'synthetic-selected') }));
  const acceptance = createAcceptanceBot('test-only-placeholder', owner, create, result => results.push(result));
  acceptance.bot.botInfo = { id: 9001, is_bot: true, first_name: 'Synthetic', username: 'test_acceptance' } as UserFromGetMe;
  const sends: unknown[] = [];
  acceptance.bot.api.config.use((previous, method, payload) => {
    expect(method).toBe('sendMessage'); sends.push(payload);
    return Promise.resolve({ ok: true, result: { message_id: 2, date: 0, chat: { id: owner, type: 'private' } } }) as ReturnType<typeof previous<typeof method>>;
  });
  const update = (user: number, group = false): Update => ({ update_id: 1, message: { message_id: 1, date: 0,
    from: { id: user, is_bot: false, first_name: 'Synthetic' }, chat: group ? { id: -100, type: 'group', title: 'Synthetic' } :
      { id: user, type: 'private', first_name: 'Synthetic' }, text: '/acceptance', entities: [{ type: 'bot_command', offset: 0, length: 11 }] } });
  await acceptance.bot.handleUpdate(update(owner, true)); await acceptance.bot.handleUpdate(update(owner + 1));
  expect(create).not.toHaveBeenCalled(); expect(sends).toEqual([]);
  await Promise.all([acceptance.bot.handleUpdate(update(owner)), acceptance.bot.handleUpdate(update(owner))]);
  await acceptance.bot.handleUpdate(update(owner)); await acceptance.shutdown();
  expect(create).toHaveBeenCalledTimes(1); expect(s.read).toHaveBeenCalledTimes(1); expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ chat_id: owner, reply_markup: { inline_keyboard: [[{ url: 'https://kwork.ru/new_offer?project=9000001' }]] } });
  expect(JSON.stringify(results)).not.toContain('synthetic-selected'); expect(JSON.stringify(results)).not.toContain('React');
});
it('requires an existing baseline and never initializes or rereads a completed message in acceptance', async () => {
  const s = setup(); s.store.recordMessage('synthetic-selected', 'parse_failed'); await s.pass.run();
  expect(s.read).not.toHaveBeenCalled(); expect(s.notifier.send).not.toHaveBeenCalled();
  const dir = mkdtempSync(join(tmpdir(), 'kwork-no-baseline-')); dirs.push(dir);
  const store = new MonitorStore(join(dir, 'state.sqlite'), 'synthetic'); stores.push(store);
  const pass = createAcceptancePass({ store, notifier: s.notifier, connect: s.connect }, 'synthetic-selected');
  s.connect.mockClear(); expect((await pass.run()).status).toBe('acceptance_baseline_required'); expect(s.connect).not.toHaveBeenCalled();
});
