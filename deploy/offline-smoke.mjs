// Only synthetic state under OS temp. No configuration, real entry point or API client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MonitorStore } from '../dist/monitor/store.js';
import { checkDeploymentState } from '../dist/ops/deploymentState.js';
import { createMonitorController } from '../dist/monitor/controller.js';
import { createBotLifecycle } from '../dist/bot/lifecycle.js';

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
