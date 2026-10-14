import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { MonitorStore, StorageError } from '../src/monitor/store.js';
import { collectHistory } from '../src/monitor/discovery.js';
import { createMonitoringPass } from '../src/monitor/pass.js';
import type { MonitoringGmail } from '../src/gmail/monitorClient.js';
import { GmailError } from '../src/gmail/client.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';
const dirs: string[] = [], stores: MonitorStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup(ids: string[] = ['synthetic-a']) {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-pass-')); dirs.push(dir);
  const store = new MonitorStore(join(dir, 'state.sqlite'), 'binding'); stores.push(store);
  const read = vi.fn<MonitoringGmail['reader']['getProjectMessage']>(async (id: string) => ({ diagnostics: [], message: { id, payload: {
    mimeType: 'text/html', body: { data: Buffer.from('<table>' + TABLE_HEADER +
      TABLE_ROW.replace('Синтетический интерфейс', 'Исправить React баг') + '</table>').toString('base64url') },
  } } }));
  const historyPage = vi.fn(async () => ({ historyId: '300', records: [{ historyId: '200', messageIds: ids }] }));
  const client: MonitoringGmail = { currentHistoryId: async () => '300', historyPage,
    reader: { getProjectMessage: read } };
  const sent: string[] = [];
  const notifier = { hasConfirmedDestination: () => true, send: vi.fn(async (p: { projectId: string }) => {
    sent.push(p.projectId); return { status: 'sent' as const };
  }) };
  const connect = vi.fn(async () => client);
  const pass = createMonitoringPass({ store, notifier, connect, now: () => 1000 });
  return { store, client, read, sent, notifier, connect, pass, dir };
}
it('initializes from the current cursor without reading or sending historical messages', async () => {
  const s = setup(); expect((await s.pass.run()).status).toBe('initialized');
  expect(s.store.cursor()).toEqual({ historyId: '300', floor: 1000 });
  expect(s.read).not.toHaveBeenCalled(); expect(s.sent).toEqual([]);
});
it('sends a new project once across repeat messages, duplicate emails and restart', async () => {
  const s = setup(['synthetic-a', 'synthetic-b']); s.store.baseline('100', 1000);
  expect(await s.pass.run()).toMatchObject({ status: 'completed', sent: 1 });
  s.store.checkpoint('300'); // no new events means no reads
  await s.pass.run(); expect(s.sent).toEqual(['9000001']);
  s.store.close();
  const restarted = new MonitorStore(join(s.dir, 'state.sqlite'), 'binding'); stores.push(restarted);
  restarted.baseline('100', 1000, true);
  const pass = createMonitoringPass({ store: restarted, notifier: s.notifier, connect: s.connect });
  await pass.run(); expect(s.sent).toEqual(['9000001']); expect(s.read).toHaveBeenCalledTimes(2);
});
it('reads all bounded pages, deduplicates IDs and fences later events without timestamp loss', async () => {
  const s = setup();
  s.client.historyPage = vi.fn().mockResolvedValueOnce({ historyId: '500', nextPageToken: 'next',
    records: [{ historyId: '200', messageIds: ['synthetic-a'] }] }).mockResolvedValueOnce({ historyId: '500',
    records: [{ historyId: '250', messageIds: ['synthetic-a', 'synthetic-b'] }, { historyId: '400', messageIds: ['synthetic-later'] }] });
  expect(await collectHistory(s.client, '100', '300')).toEqual(['synthetic-a', 'synthetic-b']);
});
it('does no body work or checkpoint advance on partial pagination, timeout or overflow', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  s.client.historyPage = vi.fn().mockResolvedValueOnce({ historyId: '300', nextPageToken: 'next',
    records: [{ historyId: '200', messageIds: ['synthetic-a'] }] }).mockRejectedValueOnce(new Error('synthetic-private-error'));
  expect((await s.pass.run()).status).toBe('gmail_error');
  expect(s.store.cursor()?.historyId).toBe('100'); expect(s.sent).toEqual([]); expect(s.read).not.toHaveBeenCalled();
  s.client.historyPage = vi.fn(async () => ({ historyId: '300', records: [{ historyId: '200',
    messageIds: Array.from({ length: 101 }, (_, n) => 'synthetic-' + n) }] }));
  expect((await s.pass.run()).status).toBe('discovery_overflow');
  expect(s.store.cursor()?.historyId).toBe('100'); expect(s.read).not.toHaveBeenCalled();
});
it('makes parse failures terminal and never automatically rereads the body', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  s.read.mockResolvedValue({ diagnostics: [], message: { id: 'synthetic-a', payload: { mimeType: 'text/html', body: { data: 'invalid*' } } } });
  expect(await s.pass.run()).toMatchObject({ status: 'completed', parseFailed: 1, sent: 0 });
  s.store.baseline('100', 1000, true); await s.pass.run();
  expect(s.read).toHaveBeenCalledTimes(1);
});
it('records Telegram errors as terminal delivery_unknown without a retry', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  s.notifier.send.mockImplementation(async () => { throw new Error('synthetic-private-timeout'); });
  expect(await s.pass.run()).toMatchObject({ status: 'completed', unknown: 1, sent: 0 });
  expect(s.store.counts().delivery_unknown).toBe(1);
  s.store.baseline('100', 1000, true); await s.pass.run();
  expect(s.notifier.send).toHaveBeenCalledTimes(1);
});
it('does no Gmail work without a confirmed private destination', async () => {
  const s = setup(); s.notifier.hasConfirmedDestination = () => false;
  expect((await s.pass.run()).status).toBe('destination_unconfirmed'); expect(s.connect).not.toHaveBeenCalled();
});
it('shares one active pass and stops before reservation/send after a pending read', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  let resolveRead!: (v: Awaited<ReturnType<typeof s.read>>) => void;
  const response = await s.read('synthetic-a'); s.read.mockImplementation(() => new Promise(r => { resolveRead = r; }));
  let allowed = true; const running = s.pass.run(() => allowed);
  await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
  expect((await s.pass.run()).status).toBe('busy');
  allowed = false; resolveRead(response);
  expect((await running).status).toBe('stopped'); expect(s.sent).toEqual([]); expect(s.store.counts().messages).toBe(0);
});
it('handles multiple projects and sends match and review while filtering exclude', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  const rows = [['9000001', 'Исправить React баг'], ['9000002', 'React'], ['9000003', 'WordPress исправить баг']]
    .map(([id, title]) => TABLE_ROW.replaceAll('9000001', id!).replace('Синтетический интерфейс', title!)).join('');
  s.read.mockResolvedValue({ diagnostics: [], message: { id: 'synthetic-a', payload: { mimeType: 'text/html',
    body: { data: Buffer.from('<table>' + TABLE_HEADER + rows + '</table>').toString('base64url') } } } });
  expect(await s.pass.run()).toMatchObject({ status: 'completed', found: 3, match: 1, review: 1, exclude: 1, sent: 2 });
  expect(s.store.counts()).toMatchObject({ sent: 2, filtered: 1 });
  expect(s.store.counts()).toMatchObject({ review: 1, exclude: 1 });
  expect(s.notifier.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ projectId: '9000002' }),
    { classification: 'review', reasons: ['insufficient_evidence'] });
});
it('bounds temporary read retries to three later passes without moving cursor on the first failures', async () => {
  const s = setup(); s.store.baseline('100', 1000); s.read.mockRejectedValue(new Error('synthetic-timeout'));
  expect((await s.pass.run()).status).toBe('partial'); expect(s.store.cursor()?.historyId).toBe('100');
  expect((await s.pass.run()).status).toBe('partial');
  expect((await s.pass.run()).status).toBe('completed'); expect(s.store.cursor()?.historyId).toBe('300');
  await s.pass.run(); expect(s.read).toHaveBeenCalledTimes(3); expect(s.sent).toEqual([]);
});
it('records historical messages without sending', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  s.read.mockResolvedValue({ diagnostics: ['historical_message'] });
  expect(await s.pass.run()).toMatchObject({ status: 'completed', sent: 0 });
  expect(s.store.hasMessage('synthetic-a')).toBe(true);
});
it('makes a storage failure after accepted send fail closed across restart', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  vi.spyOn(s.store, 'settle').mockImplementation(() => { throw new StorageError(); });
  expect((await s.pass.run()).status).toBe('storage_error'); expect(s.sent).toHaveLength(1);
  expect(s.store.cursor()?.historyId).toBe('100'); s.store.close();
  const restarted = new MonitorStore(join(s.dir, 'state.sqlite'), 'binding'); stores.push(restarted);
  expect(restarted.counts().delivery_unknown).toBe(1);
  await createMonitoringPass({ store: restarted, notifier: s.notifier, connect: s.connect }).run();
  expect(s.sent).toHaveLength(1);
});
it('refuses body work when storage is unavailable', async () => {
  const s = setup(); s.store.close();
  expect((await s.pass.run()).status).toBe('storage_error'); expect(s.connect).not.toHaveBeenCalled();
});
it('rejects repeated page tokens and page cap without returning partial IDs', async () => {
  const s = setup();
  s.client.historyPage = vi.fn(async () => ({ historyId: '300', records: [], nextPageToken: 'same' }));
  await expect(collectHistory(s.client, '100', '300')).rejects.toThrow('discovery_error');
  await expect(collectHistory(s.client, '100', '300', { maxPages: 1, maxMessages: 100, maxProjects: 200, maxSends: 10 }))
    .rejects.toThrow('discovery_overflow');
});
it('does not mask a post-send storage failure as an ordinary stop', async () => {
  const s = setup(); s.store.baseline('100', 1000); let allowed = true;
  s.notifier.send.mockImplementation(async () => { allowed = false; return { status: 'sent' }; });
  vi.spyOn(s.store, 'settle').mockImplementation(() => { throw new StorageError(); });
  expect((await s.pass.run(() => allowed)).status).toBe('storage_error');
  expect(s.notifier.send).toHaveBeenCalledTimes(1); expect(s.store.cursor()?.historyId).toBe('100');
});
it('does not silently replace an existing baseline or contact Gmail on repeated initialization', async () => {
  const s = setup(); s.store.baseline('100', 1000);
  expect((await s.pass.run(() => true, true)).status).toBe('baseline_exists');
  expect(s.store.cursor()).toEqual({ historyId: '100', floor: 1000 });
  expect(s.connect).not.toHaveBeenCalled();
});
it('captures activation time before history capture so mail arriving during initialization is not historical', async () => {
  const s = setup(); let now = 1000;
  s.client.currentHistoryId = async () => { now = 2000; return '100'; };
  const pass = createMonitoringPass({ store: s.store, notifier: s.notifier, connect: s.connect, now: () => now });
  expect((await pass.run()).status).toBe('initialized');
  expect(s.store.cursor()).toEqual({ historyId: '100', floor: 1000 });
});
it.each(['message_metadata', 'message_full'] as const)('pauses a reader permission error at %s without terminalizing the message or moving its cursor', async stage => {
  const s = setup(); s.store.baseline('100', 1000);
  s.read.mockRejectedValue(new GmailError('safe', stage, 'insufficient_scope', 403));
  expect((await s.pass.run()).status).toBe('gmail_access_error');
  expect(s.store.counts().messages).toBe(0); expect(s.store.cursor()?.historyId).toBe('100');
});
it('fences non-contiguous history IDs above MAX_SAFE_INTEGER and retains later pagination events for the next pass', async () => {
  const s = setup(); s.store.baseline('90071992547409930', 1000);
  s.client.currentHistoryId = async () => '90071992547409939';
  s.client.historyPage = vi.fn(async () => ({ historyId: '90071992547409950', records: [
    { historyId: '90071992547409931', messageIds: ['synthetic-a'] },
    { historyId: '90071992547409940', messageIds: ['synthetic-b'] },
  ] }));
  await s.pass.run(); expect(s.read.mock.calls.map(c => c[0])).toEqual(['synthetic-a']);
  expect(s.store.cursor()?.historyId).toBe('90071992547409939');
  s.client.currentHistoryId = async () => '90071992547409950';
  await s.pass.run(); expect(s.read.mock.calls.map(c => c[0])).toEqual(['synthetic-a', 'synthetic-b']);
  expect(s.notifier.send).toHaveBeenCalledTimes(1);
});
it('retains retry state and cursor across restart until durable terminal processing', async () => {
  const s = setup(); s.store.baseline('100', 1000); s.read.mockRejectedValueOnce(Error('synthetic-timeout'));
  expect((await s.pass.run()).status).toBe('partial'); s.store.close();
  const restarted = new MonitorStore(join(s.dir, 'state.sqlite'), 'binding'); stores.push(restarted);
  expect(restarted.cursor()?.historyId).toBe('100');
  expect(await createMonitoringPass({ store: restarted, notifier: s.notifier, connect: s.connect }).run()).toMatchObject({ status: 'completed', sent: 1 });
  expect(restarted.hasMessage('synthetic-a')).toBe(true); expect(restarted.cursor()?.historyId).toBe('300');
});
it('does not begin another page or body after cancellation during pagination', async () => {
  const s = setup(); s.store.baseline('100', 1000); let allowed = true;
  s.client.historyPage = vi.fn(async () => { allowed = false; return { historyId: '300', records: [], nextPageToken: 'later' }; });
  expect((await s.pass.run(() => allowed)).status).toBe('stopped');
  expect(s.client.historyPage).toHaveBeenCalledTimes(1); expect(s.read).not.toHaveBeenCalled(); expect(s.store.cursor()?.historyId).toBe('100');
});
it('stops between durable reservation and send, preserving terminal project identities', async () => {
  const s = setup(); s.store.baseline('100', 1000); let allowed = true;
  const record = s.store.recordMessage.bind(s.store);
  vi.spyOn(s.store, 'recordMessage').mockImplementation((...args) => { const result = record(...args); allowed = false; return result; });
  expect((await s.pass.run(() => allowed)).status).toBe('stopped');
  expect(s.notifier.send).not.toHaveBeenCalled(); expect(s.store.counts().delivery_unknown).toBe(1);
});
