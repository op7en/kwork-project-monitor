import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { checkDeploymentState, checkRuntimeState } from '../src/ops/deploymentState.js';
import { MonitorStore } from '../src/monitor/store.js';
import { createMonitorController, type MonitorController } from '../src/monitor/controller.js';
import type { PassResult } from '../src/monitor/pass.js';
import { safeErrorDetails } from '../src/gmail/client.js';
import { GrammyError, HttpError } from 'grammy';
import { spawnSync } from 'node:child_process';

const binding = createHash('sha256').update('synthetic-binding').digest('hex');
const dirs: string[] = [], stores: MonitorStore[] = [], controllers: MonitorController[] = [];
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.shutdown();
  for (const s of stores.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() { const dir = mkdtempSync(join(tmpdir(), 'kwork-stage-b-')); dirs.push(dir); return dir; }
function open(dir: string) { const s = new MonitorStore(join(dir, 'monitor.sqlite'), binding); stores.push(s); return s; }
function fixture(baseline = true) {
  const dir = directory(), store = open(dir); if (baseline) store.baseline('100', 1000);
  return { dir, store, path: join(dir, 'monitor.sqlite') };
}
const completed: PassResult = { status: 'completed', messages: 0, found: 0, match: 0, review: 0, exclude: 0, sent: 0, unknown: 0, parseFailed: 0 };
function controller(store: MonitorStore, available = true) {
  let confirmed = false;
  const notifier = { hasConfirmedDestination: () => confirmed, restoreConfirmedDestination: vi.fn(() => { confirmed = true; }),
    sendAlert: vi.fn<(text: string) => Promise<boolean>>(async () => true) };
  const run = vi.fn<(allowed: () => boolean) => Promise<PassResult>>(async () => completed);
  const create = vi.fn(() => ({ store, pass: { run } }));
  const monitor = createMonitorController(notifier, create, 60_000, () => {}, () => available); controllers.push(monitor);
  return { monitor, notifier, run, create, confirm: () => { confirmed = true; } };
}
it('allows pristine runtime bootstrap without creating state or weakening transfer checks', () => {
  const dir = directory(); expect(() => checkRuntimeState(dir, binding)).not.toThrow();
  expect(existsSync(join(dir, 'monitor.sqlite'))).toBe(false);
  expect(() => checkDeploymentState(dir, binding)).toThrow('deployment_state_missing');
});
it.each(['database', 'guard'])('rejects an incomplete runtime pair: missing %s', missing => {
  const f = fixture(); f.store.close(); unlinkSync(f.path + (missing === 'guard' ? '.guard.json' : ''));
  expect(() => checkRuntimeState(f.dir, binding)).toThrow('deployment_state_missing');
});
it('allows a missing baseline at runtime only', () => {
  const f = fixture(false); f.store.close(); expect(() => checkRuntimeState(f.dir, binding)).not.toThrow();
  expect(() => checkDeploymentState(f.dir, binding)).toThrow('deployment_baseline_missing');
});
it('recovers an orphan with the current PID without admitting an active second store', () => {
  const f = fixture(); f.store.recordMessage('synthetic-a', 'parsed', [{ projectId: '123', classification: 'review', reasons: ['insufficient_evidence'] }]);
  expect(() => open(f.dir)).toThrow('storage_busy'); f.store.close(); const db = new DatabaseSync(f.path);
  db.prepare('INSERT INTO session VALUES(1,?,?,?)').run('synthetic-orphan', process.pid, hostname()); db.close();
  expect(() => checkRuntimeState(f.dir, binding)).not.toThrow();
  expect(() => checkDeploymentState(f.dir, binding)).toThrow('deployment_state_busy');
  expect(open(f.dir).counts()).toMatchObject({ reserved: 0, delivery_unknown: 1 });
});
it('synchronizes DB-ahead-of-guard in constructor recovery', () => {
  const f = fixture(), old = readFileSync(f.path + '.guard.json'); f.store.setEnabled(true); f.store.close();
  writeFileSync(f.path + '.guard.json', old); expect(() => checkRuntimeState(f.dir, binding)).not.toThrow();
  expect(() => checkDeploymentState(f.dir, binding)).toThrow('deployment_state_invalid');
  const recovered = open(f.dir); expect(recovered.enabled()).toBe(true); recovered.close();
  expect(() => checkDeploymentState(f.dir, binding)).not.toThrow();
});
it('rejects a gap larger than one revision without rewriting the independently retained guard', () => {
  const f = fixture(), old = readFileSync(f.path + '.guard.json');
  f.store.setEnabled(true); f.store.setEnabled(false); f.store.close(); writeFileSync(f.path + '.guard.json', old);
  expect(() => checkRuntimeState(f.dir, binding)).toThrow('deployment_state_invalid');
  expect(() => open(f.dir)).toThrow('storage_error');
  expect(readFileSync(f.path + '.guard.json')).toEqual(old);
});
it('recovers a SIGKILLed writer with simulated PID reuse while retaining opt-in and tombstones', async () => {
  const dir = directory(), path = join(dir, 'monitor.sqlite');
  const source = new URL('../src/monitor/store.ts', import.meta.url).href;
  const script = `import {MonitorStore} from ${JSON.stringify(source)}; import {writeSync} from 'node:fs';
    const s=new MonitorStore(process.argv[1],process.argv[2]); s.baseline('100',1000); s.setEnabled(true);
    s.recordMessage('synthetic-crash','parsed',[{projectId:'123',classification:'review',reasons:['insufficient_evidence']}]);
    writeSync(1,'synthetic_crash_ready'); process.kill(process.pid,'SIGKILL');`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, path, binding], {
    encoding: 'utf8', timeout: 10000, env: { TEMP: tmpdir(), TMP: tmpdir() },
  });
  expect(child.error).toBeUndefined(); expect(child.stdout).toBe('synthetic_crash_ready'); expect(child.status).not.toBe(0);
  // Windows cannot force PID namespace reuse; reproduce its exact persisted inputs in this synthetic DB.
  const db = new DatabaseSync(path); db.prepare('UPDATE session SET pid=?,host=?').run(process.pid, hostname()); db.close();
  expect(() => checkRuntimeState(dir, binding)).not.toThrow();
  const recovered = open(dir), s = controller(recovered);
  expect(await s.monitor.restore()).toMatchObject({ status: 'completed' });
  expect(recovered.counts()).toMatchObject({ delivery_unknown: 1, reserved: 0 });
  expect(recovered.hasProject('123')).toBe(true); expect(recovered.enabled()).toBe(true);
}, 15000);
it('rejects foreign binding and DB-behind-guard at runtime', () => {
  const f = fixture(); f.store.close(); expect(() => checkRuntimeState(f.dir, 'wrong')).toThrow('deployment_binding_mismatch');
  const guard = JSON.parse(readFileSync(f.path + '.guard.json', 'utf8')) as { revision: string };
  guard.revision = String(BigInt(guard.revision) + 1n); writeFileSync(f.path + '.guard.json', JSON.stringify(guard));
  expect(() => checkRuntimeState(f.dir, binding)).toThrow('deployment_state_invalid');
});
it('restores persisted opt-in and destination with baseline and retains opt-in on shutdown', async () => {
  const f = fixture(); expect(f.store.enabled()).toBe(false); f.store.setEnabled(true); f.store.close();
  const s = controller(open(f.dir)); expect(await s.monitor.restore()).toMatchObject({ status: 'completed' });
  expect(s.notifier.restoreConfirmedDestination).toHaveBeenCalledOnce(); expect(s.run).toHaveBeenCalledOnce();
  expect(s.monitor.status().enabled).toBe(true); await s.monitor.shutdown(); expect(open(f.dir).enabled()).toBe(true);
});
it.each([false, true])('does not restore without baseline even if enabled=%s', async enabled => {
  const f = fixture(false); f.store.setEnabled(enabled); const s = controller(f.store);
  expect(await s.monitor.restore()).toMatchObject({ status: 'disabled' });
  expect(s.notifier.restoreConfirmedDestination).not.toHaveBeenCalled(); expect(s.run).not.toHaveBeenCalled();
});
it('does no storage work during pristine restore', async () => {
  const s = controller(fixture().store, false); expect(await s.monitor.restore()).toMatchObject({ status: 'disabled' });
  expect(s.create).not.toHaveBeenCalled();
});
it('persists explicit owner on/off and keeps OFF after restart', async () => {
  const f = fixture(), s = controller(f.store); s.confirm(); await s.monitor.on(); expect(f.store.enabled()).toBe(true);
  await s.monitor.off(); expect(f.store.enabled()).toBe(false); await s.monitor.shutdown();
  const restarted = controller(open(f.dir)); expect(await restarted.monitor.restore()).toMatchObject({ status: 'disabled' });
  expect(restarted.notifier.restoreConfirmedDestination).not.toHaveBeenCalled();
});
it('persists initial opt-in after baseline creation', async () => {
  const f = fixture(false), s = controller(f.store); s.confirm();
  s.run.mockImplementation(async () => { f.store.baseline('100', 1000); return { ...completed, status: 'initialized' }; });
  await s.monitor.on(); expect(f.store.enabled()).toBe(true);
});
it('clears opt-in and alerts once when entering PAUSE', async () => {
  const f = fixture(), s = controller(f.store); s.confirm(); s.run.mockResolvedValue({ ...completed, status: 'history_expired' });
  expect(await s.monitor.on()).toMatchObject({ status: 'history_expired' }); expect(f.store.enabled()).toBe(false);
  expect(s.monitor.status()).toMatchObject({ enabled: false, blocked: true });
  expect(s.notifier.sendAlert).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('история Gmail'));
  await s.monitor.run(); s.monitor.status(); expect(s.notifier.sendAlert).toHaveBeenCalledOnce();
});
it('does not overwrite OFF after a pending on pass settles', async () => {
  const f = fixture(), s = controller(f.store); s.confirm(); let release!: () => void;
  s.run.mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return completed; });
  const active = s.monitor.on(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const off = s.monitor.off(); release(); await active; await off;
  expect(f.store.enabled()).toBe(false); expect(s.monitor.status().enabled).toBe(false);
});
it('does not recurse when the PAUSE alert itself fails', async () => {
  const f = fixture(), s = controller(f.store); s.confirm();
  s.notifier.sendAlert.mockRejectedValue(Error('SYNTHETIC_PRIVATE_ALERT_ERROR'));
  s.run.mockResolvedValue({ ...completed, status: 'history_expired' });
  expect(await s.monitor.on()).toMatchObject({ status: 'history_expired' });
  expect(f.store.enabled()).toBe(false); expect(s.notifier.sendAlert).toHaveBeenCalledOnce();
});
it('preserves approved wrapped Telegram HTTP and API codes without raw errors', () => {
  const api = new GrammyError('SYNTHETIC_SECRET', { ok: false, error_code: 403, description: 'SYNTHETIC_SECRET' }, 'sendMessage', {});
  expect(safeErrorDetails(api, 'telegram')).toMatchObject({ name: 'GrammyError', apiErrorCode: 403 });
  const transport = new HttpError('SYNTHETIC_SECRET', { code: 'ECONNRESET', status: 503, body: 'SYNTHETIC_SECRET' });
  const details = safeErrorDetails(transport, 'telegram');
  expect(details).toMatchObject({ name: 'HttpError', code: 'ECONNRESET', httpStatus: 503 });
  expect(JSON.stringify(details)).not.toContain('SYNTHETIC_SECRET');
});
it('retains only approved diagnostic fields, never messages, paths or arbitrary codes', () => {
  const details = safeErrorDetails({ name: 'Error', code: 'EACCES', message: 'SYNTHETIC_SECRET /private/path',
    request: { token: 'SYNTHETIC_SECRET' }, response: { status: 403, data: 'SYNTHETIC_SECRET' } }, 'storage');
  expect(details).toMatchObject({ name: 'Error', code: 'EACCES', httpStatus: 403, stage: 'storage' });
  expect(JSON.stringify(details)).not.toContain('SYNTHETIC_SECRET');
  expect(JSON.stringify(safeErrorDetails({ name: 'SYNTHETIC_SECRET', code: 'SYNTHETIC_SECRET' }, 'storage'))).not.toContain('SYNTHETIC_SECRET');
});
