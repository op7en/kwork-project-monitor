import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { MonitorStore } from '../src/monitor/store.js';
import { checkDeploymentState, checkRestoreGuard } from '../src/ops/deploymentState.js';

const binding = createHash('sha256').update('synthetic@example.com:123').digest('hex');
const dirs: string[] = [];
function fixture(baseline = true) {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-deploy-test-')); dirs.push(dir);
  const path = join(dir, 'monitor.sqlite');
  const store = new MonitorStore(path, binding);
  if (baseline) store.baseline('100', 1000);
  store.recordMessage('synthetic-mail', 'parsed', [{ projectId: '123', classification: 'match', reasons: ['stack_and_task'] }]);
  store.settle('123', 'sent'); store.close();
  return { dir, path, guard: path + '.guard.json' };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('checks an existing baseline without modifying ledger, guard, cursor or tombstones', () => {
  const f = fixture(), dbBefore = readFileSync(f.path), guardBefore = readFileSync(f.guard);
  checkDeploymentState(f.dir, binding);
  expect(readFileSync(f.path)).toEqual(dbBefore); expect(readFileSync(f.guard)).toEqual(guardBefore);
  const db = new DatabaseSync(f.path, { readOnly: true });
  expect(db.prepare("SELECT value FROM meta WHERE key='history'").get()?.['value']).toBe('100');
  expect(db.prepare("SELECT state FROM projects WHERE id='123'").get()?.['state']).toBe('sent'); db.close();
});
it.each(['both', 'database', 'guard'] as const)('fails closed with missing %s, without initialization', missing => {
  const f = fixture();
  if (missing !== 'guard') unlinkSync(f.path);
  if (missing !== 'database') unlinkSync(f.guard);
  expect(() => checkDeploymentState(f.dir)).toThrow('deployment_state_missing');
});
it('refuses a missing baseline rather than initializing or accessing Gmail', () => {
  const f = fixture(false);
  expect(() => checkDeploymentState(f.dir)).toThrow('deployment_baseline_missing');
});
it('refuses the wrong account or owner binding', () => {
  const f = fixture();
  expect(() => checkDeploymentState(f.dir, 'different-binding')).toThrow('deployment_binding_mismatch');
});
it.each(['behind', 'ahead', 'epoch', 'malformed'] as const)('refuses %s guard mismatch without repairing it', kind => {
  const f = fixture(); const value = JSON.parse(readFileSync(f.guard, 'utf8')) as { epoch: string; revision: string };
  if (kind === 'behind') value.revision = String(BigInt(value.revision) + 1n);
  if (kind === 'ahead') value.revision = String(BigInt(value.revision) - 1n);
  if (kind === 'epoch') value.epoch = '00000000-0000-0000-0000-000000000000';
  writeFileSync(f.guard, kind === 'malformed' ? 'invalid synthetic guard' : JSON.stringify(value));
  const before = readFileSync(f.guard);
  expect(() => checkDeploymentState(f.dir)).toThrow('deployment_state_invalid');
  expect(readFileSync(f.guard)).toEqual(before);
});
it.each(['corrupt', 'empty', 'schema'] as const)('refuses %s database with a fixed error', kind => {
  const f = fixture();
  if (kind === 'schema') { const db = new DatabaseSync(f.path); db.exec('PRAGMA user_version=99'); db.close(); }
  else writeFileSync(f.path, kind === 'empty' ? '' : 'synthetic corrupt database');
  expect(() => checkDeploymentState(f.dir)).toThrow('deployment_state_invalid');
});
it('refuses an occupied or orphan session even from a different host; never unlocks', () => {
  const f = fixture(); const db = new DatabaseSync(f.path);
  db.prepare('INSERT INTO session VALUES (1, ?, ?, ?)').run('synthetic-session', 2147483647, 'synthetic-host'); db.close();
  expect(() => checkDeploymentState(f.dir)).toThrow('deployment_state_busy');
  const reader = new DatabaseSync(f.path, { readOnly: true });
  expect(reader.prepare('SELECT count(*) AS n FROM session').get()?.['n']).toBe(1); reader.close();
});
it('refuses restore below the independently retained current guard without changing either set', () => {
  const f = fixture(), retained = join(f.dir, 'retained-guard.json');
  const value = JSON.parse(readFileSync(f.guard, 'utf8')) as { epoch: string; revision: string };
  writeFileSync(retained, JSON.stringify(value));
  expect(() => checkRestoreGuard(f.dir, retained)).not.toThrow();
  value.revision = String(BigInt(value.revision) + 1n); writeFileSync(retained, JSON.stringify(value));
  const before = readFileSync(f.guard);
  expect(() => checkRestoreGuard(f.dir, retained)).toThrow('deployment_restore_refused');
  expect(readFileSync(f.guard)).toEqual(before);
  value.epoch = '00000000-0000-0000-0000-000000000000'; writeFileSync(retained, JSON.stringify(value));
  expect(() => checkRestoreGuard(f.dir, retained)).toThrow('deployment_restore_refused');
  expect(() => checkRestoreGuard(f.dir, join(f.dir, 'missing-current-guard.json'))).toThrow('deployment_restore_refused');
});
it('deployment startup rejects absent state before importing polling and never prints configuration values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-deploy-start-')); dirs.push(dir);
  const entry = new URL('../src/ops/start.ts', import.meta.url).pathname;
  const result = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
    decodeURIComponent(process.platform === 'win32' ? entry.slice(1) : entry)], {
    cwd: dir, env: { TELEGRAM_BOT_TOKEN: 'synthetic-do-not-contact', TELEGRAM_OWNER_ID: '123',
      GMAIL_CLIENT_ID: 'synthetic-client', GMAIL_CLIENT_SECRET: 'synthetic-secret', GMAIL_REFRESH_TOKEN: 'synthetic-refresh',
      GMAIL_EXPECTED_ACCOUNT_EMAIL: 'synthetic@example.com' }, encoding: 'utf8', timeout: 5000,
  });
  expect(result.status).toBe(1); expect(result.stdout).toBe('');
  expect(result.stderr).toContain('deployment_state_missing');
  expect(result.stderr).not.toContain('synthetic-'); expect(result.stderr).not.toContain('synthetic@example.com');
});
