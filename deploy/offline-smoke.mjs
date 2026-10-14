// Only synthetic state under OS temp. No configuration, real entry point or API client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MonitorStore } from '../dist/monitor/store.js';
import { checkDeploymentState, checkRuntimeState } from '../dist/ops/deploymentState.js';
import { createMonitorController } from '../dist/monitor/controller.js';
import { createBotLifecycle } from '../dist/bot/lifecycle.js';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

// Explicit opt-in integration harness. No production entrypoint, credentials or network clients.
if (process.argv.includes('--m7')) {
  try { await reliabilitySmoke(); }
  catch (error) { console.error('m7_offline_failed', error instanceof assert.AssertionError ? error.message : error?.name); process.exitCode = 1; }
  process.exit(process.exitCode ?? 0);
}

async function reliabilitySmoke() {
  const option = process.argv.indexOf('--state-dir');
  assert.ok(option > 0 && process.argv[option + 1]);
  const dir = process.argv[option + 1], path = join(dir, 'monitor.sqlite');
  const marker = join(dir, '.m7-synthetic-state'), binding = createHash('sha256').update('synthetic@example.com:123').digest('hex');
  const seed = process.argv.includes('--seed');
  let store;
  if (seed) {
    assert.deepEqual(readdirSync(dir), []); writeFileSync(marker, 'M7 synthetic only\n', { flag: 'wx', mode: 0o600 });
    checkRuntimeState(dir, binding);
    const clean = createMonitorController({ hasConfirmedDestination: () => false }, () => { throw Error('unexpected_bootstrap'); }, 60000);
    assert.equal((await clean.restore()).status, 'disabled'); await clean.shutdown();
    assert.deepEqual(readdirSync(dir), ['.m7-synthetic-state']);
    store = new MonitorStore(path, binding); store.baseline('100', 1000); store.setEnabled(true); store.close();
  } else assert.equal(readFileSync(marker, 'utf8'), 'M7 synthetic only\n');
  const before = new DatabaseSync(path, { readOnly: true });
  const previousPid = before.prepare('SELECT pid FROM session').get()?.pid; before.close();
  if (process.argv.includes('--expect-same-pid')) assert.equal(previousPid, process.pid);
  checkRuntimeState(dir, binding); store = new MonitorStore(path, binding);
  try {
    assert.throws(() => new MonitorStore(path, binding), /storage_busy/);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {MonitorStore} from './dist/monitor/store.js';try{new MonitorStore(process.argv[1],process.argv[2]);process.exit(2)}catch(e){process.exit(e.code==='storage_busy'?0:3)}`, path, binding], { timeout: 10000 });
    assert.equal(child.status, 0);
    const { createMonitoringPass } = await import('../dist/monitor/pass.js');
    const { createProjectNotifier } = await import('../dist/bot/projectNotifications.js');
    const { Api } = await import('grammy');
    const api = new Api('synthetic-placeholder'), cards = [];
    api.config.use((previous, method, payload) => {
      assert.equal(method, 'sendMessage'); cards.push(payload);
      return Promise.resolve({ ok: true, result: { message_id: 1, date: 0, chat: { id: 123, type: 'private' } } });
    });
    const notifier = createProjectNotifier(api, 123);
    const prices = ['5 000 ₽', 'до 10 000 ₽', 'от 5 000 ₽', '8 000–12 000 ₽'];
    const html = '<table><tr><th>Название</th><th>Покупатель</th><th>Цена</th></tr>' + Array.from({ length: 30 }, (_, i) =>
      `<tr><td><a href="https://kwork.ru/new_offer?project=${9000001 + i}">${i % 2 ? 'Написать Telegram бот' : 'Исправить React баг'}</a></td><td>Synthetic</td><td>${prices[i % 4]}</td></tr>`).join('') + '<tr><td>bad row</td></tr></table>';
    let reads = 0, connections = 0;
    const pass = createMonitoringPass({ store, notifier, connect: async () => {
      connections++; return { currentHistoryId: async () => '200', historyPage: async () => ({ historyId: '200',
        records: [{ historyId: '200', messageIds: ['synthetic-m7'] }] }), checkMessageMetadata: async () => true,
        reader: { getProjectMessage: async () => { reads++; return { message: { id: 'synthetic-m7', payload: {
          mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } } }, diagnostics: [] }; } } };
    } });
    const wasEnabled = store.enabled();
    const controller = createMonitorController(notifier, () => ({ store, pass }), 60000, () => {}, () => true);
    assert.equal((await controller.restore()).status, wasEnabled ? 'completed' : 'disabled');
    assert.equal(controller.status().enabled, wasEnabled);
    assert.equal(connections, wasEnabled ? 1 : 0);
    assert.equal(cards.length, seed ? 30 : 0); assert.equal(reads, seed ? 1 : 0);
    assert.equal(store.counts().sent, 30); assert.equal(store.cursor().historyId, '200');
    if (seed) {
      assert.equal(cards.filter(card => card.text.includes('Статус: На проверку (Недостаточно данных)')).length, 15);
      for (const price of prices) assert.ok(cards.some(card => card.text.includes('Цена: ' + price)));
    }
    if (process.argv.includes('--off')) { await controller.off(); assert.equal(store.enabled(), false); }
    if (process.argv.includes('--hold-reservation')) store.recordMessage('synthetic-orphan', 'parsed', [
      { projectId: '9001000', classification: 'review', reasons: ['insufficient_evidence'] }]);
    if (previousPid !== undefined) assert.equal(store.counts().delivery_unknown, 1);
    if (process.argv.includes('--db-ahead')) {
      const guard = readFileSync(path + '.guard.json'); store.setEnabled(true); writeFileSync(path + '.guard.json', guard);
    }
    if (process.argv.includes('--wait-for-signal')) {
      console.info('m7_offline_signal_ready');
      await new Promise(resolve => {
        const timeout = setTimeout(() => { process.exitCode = 1; resolve(); }, 120000);
        const stop = () => { clearTimeout(timeout); resolve(); };
        process.once('SIGTERM', stop); process.once('SIGINT', stop);
      });
    }
    await controller.shutdown(); checkDeploymentState(dir, binding);
    console.info('m7_offline_ok');
  } finally { store.close(); }
}

const stateOption = process.argv.indexOf('--state-dir');
const persistent = stateOption !== -1;
if (persistent && (!process.argv[stateOption + 1] || process.argv[stateOption + 1].startsWith('--'))) {
  console.error('offline_smoke_usage_error'); process.exit(1);
}
const dir = persistent ? process.argv[stateOption + 1] : mkdtempSync(join(tmpdir(), 'kwork-offline-smoke-'));
const marker = '.m6-synthetic-state';
const markerContent = 'M6 offline synthetic fixture only\n';
const seed = persistent && process.argv.includes('--seed');
const path = join(dir, 'monitor.sqlite');
const binding = createHash('sha256').update('synthetic@example.com:123').digest('hex');
let store;
try {
  if (persistent) {
    // Seed refuses any existing data. Resume requires our marker BEFORE SQLite is opened.
    if (seed) {
      assert.deepEqual(readdirSync(dir), []);
      writeFileSync(join(dir, marker), markerContent, { flag: 'wx', mode: 0o600 });
    } else assert.equal(readFileSync(join(dir, marker), 'utf8'), markerContent);
  }
  if (!persistent || seed) {
    store = new MonitorStore(path, binding);
    store.baseline('100', 1000);
    assert.deepEqual(store.recordMessage('synthetic-mail', 'parsed', [{
      projectId: '123', classification: 'match', reasons: ['stack_and_task'],
    }]), ['123']);
    store.settle('123', 'sent'); store.close();
  }
  checkDeploymentState(dir, binding);
  store = new MonitorStore(path, binding);
  assert.deepEqual(store.cursor(), { historyId: '100', floor: 1000 });
  assert.deepEqual(store.recordMessage('synthetic-repeated-mail', 'parsed', [{
    projectId: '123', classification: 'match', reasons: ['stack_and_task'],
  }]), []);
  assert.equal(store.counts().sent, 1);
  assert.equal(store.counts().messages, 2);
  const monitor = createMonitorController({ hasConfirmedDestination: () => false }, () => {
    throw Error('unexpected_mock_resource_open');
  }, 60_000);
  assert.equal(monitor.status().enabled, false);
  let running = true;
  const lifecycle = createBotLifecycle({ isRunning: () => running, stop: async () => { running = false; } },
    { shutdown: async () => { await monitor.shutdown(); store.close(); } }, () => { throw Error('mock_shutdown_failed'); });
  if (process.argv.includes('--wait-for-signal')) {
    console.info('offline_smoke_signal_ready');
    // Explicit bounded wait keeps the mock process alive for docker stop/SIGTERM.
    await new Promise(resolve => {
      const timeout = setTimeout(() => { process.exitCode = 1; resolve(); }, 120_000);
      const stop = () => { clearTimeout(timeout); resolve(); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
    });
  }
  await lifecycle.stop(); assert.equal(running, false);
  checkDeploymentState(dir, binding);
  assert.equal(monitor.status().enabled, false);
  console.info(process.exitCode ? 'offline_smoke_signal_timeout' : 'offline_smoke_ok');
} catch {
  console.error('offline_smoke_failed'); process.exitCode = 1;
} finally {
  store?.close();
  if (!persistent) rmSync(dir, { recursive: true, force: true });
}
