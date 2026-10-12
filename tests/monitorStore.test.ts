import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { MonitorStore } from '../src/monitor/store.js';

const dirs: string[] = [];
const stores: MonitorStore[] = [];
function file() { const dir = mkdtempSync(join(tmpdir(), 'kwork-state-test-')); dirs.push(dir); return join(dir, 'state.sqlite'); }
function open(path: string, binding = 'synthetic-binding') { const store = new MonitorStore(path, binding); stores.push(store); return store; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const match = { projectId: '123', classification: 'match' as const, reasons: ['stack_and_task' as const] };

it('atomically deduplicates messages and canonical projects across emails and restart', () => {
  const path = file(), store = open(path);
  store.baseline('100', 1000);
  expect(store.recordMessage('synthetic-a', 'parsed', [match])).toEqual(['123']);
  expect(store.recordMessage('synthetic-a', 'parsed', [match])).toEqual([]);
  expect(store.recordMessage('synthetic-b', 'parsed', [match])).toEqual([]);
  store.settle('123', 'sent'); store.close();
  const restarted = open(path);
  expect(restarted.cursor()).toEqual({ historyId: '100', floor: 1000 });
  expect(restarted.recordMessage('synthetic-c', 'parsed', [match])).toEqual([]);
  expect(restarted.counts()).toMatchObject({ sent: 1, messages: 3 });
  expect(readFileSync(path).includes(Buffer.from('synthetic title or body'))).toBe(false);
});
it('makes unresolved reservations terminal unknown after restart and never resends them', () => {
  const path = file(), store = open(path);
  store.recordMessage('synthetic-a', 'parsed', [match]); store.close();
  const restarted = open(path);
  expect(restarted.counts()).toMatchObject({ delivery_unknown: 1, reserved: 0 });
  expect(restarted.recordMessage('synthetic-b', 'parsed', [match])).toEqual([]);
});
it('rolls back a whole message when one project identity is invalid', () => {
  const store = open(file());
  expect(() => store.recordMessage('synthetic-a', 'parsed', [match, { ...match, projectId: '00123' }])).toThrow('storage_error');
  expect(store.counts()).toMatchObject({ messages: 0, reserved: 0 });
});
it('refuses a competing store without altering active reservations', () => {
  const path = file(), store = open(path);
  store.recordMessage('synthetic-a', 'parsed', [match]);
  expect(() => new MonitorStore(path, 'synthetic-binding')).toThrow('storage_busy');
  expect(store.counts()).toMatchObject({ reserved: 1, delivery_unknown: 0 });
});
it('does not reclaim a session from another host based on a local PID', () => {
  const path = file(), store = open(path); store.close();
  const db = new DatabaseSync(path);
  db.prepare('INSERT INTO session VALUES (1, ?, ?, ?)').run('synthetic-dead', 2147483647, 'synthetic-other-host');
  db.close();
  expect(() => new MonitorStore(path, 'synthetic-binding')).toThrow('storage_busy');
});
it('recovers a real crashed process and its pre-send reservation without delivery', () => {
  const path = file();
  const source = new URL('../src/monitor/store.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import {MonitorStore} from '" + source + "'; const s=new MonitorStore(process.argv[1],'synthetic-binding');" +
    "s.recordMessage('synthetic-crash','parsed',[{projectId:'123',classification:'match',reasons:['stack_and_task']}]); process.exit(0);",
    path], { encoding: 'utf8', timeout: 10_000 });
  expect(child.status).toBe(0);
  const store = open(path);
  expect(store.counts()).toMatchObject({ delivery_unknown: 1, reserved: 0 });
  expect(store.recordMessage('synthetic-after-crash', 'parsed', [match])).toEqual([]);
});
it('bounds per-message read failures across restart', () => {
  const path = file(), store = open(path);
  expect(store.readFailure('synthetic-a')).toBe(false); store.close();
  const restarted = open(path);
  expect(restarted.readFailure('synthetic-a')).toBe(false);
  expect(restarted.readFailure('synthetic-a')).toBe(true);
  expect(restarted.hasMessage('synthetic-a')).toBe(true);
});
it('refuses corrupted, unavailable, foreign schema and mismatched identity storage safely', () => {
  const path = file(); writeFileSync(path, 'synthetic corrupt database');
  expect(() => new MonitorStore(path, 'binding')).toThrow('storage_error');
  expect(() => new MonitorStore(join(path, 'blocked.sqlite'), 'binding')).toThrow('storage_error');
  const good = file(), store = open(good); store.close();
  expect(() => new MonitorStore(good, 'different-binding')).toThrow('storage_error');
  const db = new DatabaseSync(good); db.exec('PRAGMA user_version=999'); db.close();
  expect(() => new MonitorStore(good, 'synthetic-binding')).toThrow('storage_error');
});
it('explicit baseline replacement preserves dedup tombstones', () => {
  const store = open(file()); store.baseline('100', 1000);
  store.recordMessage('synthetic-a', 'parsed', [match]); store.settle('123', 'delivery_unknown');
  store.baseline('300', 3000, true);
  expect(store.cursor()).toEqual({ historyId: '300', floor: 3000 });
  expect(store.recordMessage('synthetic-b', 'parsed', [match])).toEqual([]);
});
it('refuses a truncated or preexisting uninitialized ledger instead of discarding tombstones', () => {
  const truncated = file(); writeFileSync(truncated, '');
  expect(() => open(truncated, 'binding')).toThrow('storage_error');
  expect(statSync(truncated).size).toBe(0);
  const empty = file(), db = new DatabaseSync(empty);
  db.exec('PRAGMA user_version=0'); db.close();
  expect(() => open(empty, 'binding')).toThrow('storage_error');
});
it('refuses a missing previously initialized database instead of silently creating a fresh ledger', () => {
  const path = file(), store = open(path); store.baseline('100', 1000); store.close();
  unlinkSync(path);
  expect(() => open(path)).toThrow('storage_error');
});
it('detects an older database restored without its independent high-water guard', () => {
  const path = file(), store = open(path); store.baseline('100', 1000); store.close();
  const old = readFileSync(path);
  const current = open(path); current.recordMessage('synthetic-a', 'parsed', [match]); current.settle('123', 'sent'); current.close();
  writeFileSync(path, old);
  expect(() => open(path)).toThrow('storage_error');
});
it.each(['reservation', 'sent', 'unknown', 'before_checkpoint', 'after_checkpoint', 'baseline'] as const)(
  'preserves the durable boundary after real process crash at %s', stage => {
    const path = file(), source = new URL('../src/monitor/store.ts', import.meta.url).href;
    const statements = "s.baseline('90071992547409931',1000);" + (stage === 'baseline' ? '' :
      "s.recordMessage('synthetic-crash','parsed',[{projectId:'123',classification:'match',reasons:['stack_and_task']}]);" +
      (stage === 'sent' ? "s.settle('123','sent');" : stage === 'unknown' ? "s.settle('123','delivery_unknown');" : '') +
      (stage === 'after_checkpoint' ? "s.checkpoint('90071992547409939');" : ''));
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import {MonitorStore} from '" + source + "';const s=new MonitorStore(process.argv[1],'synthetic-binding');" + statements +
      'process.exit(43);', path], { encoding: 'utf8', timeout: 10_000 });
    expect(child.status).toBe(43);
    const recovered = open(path);
    expect(recovered.cursor()?.historyId).toBe(stage === 'after_checkpoint' ? '90071992547409939' : '90071992547409931');
    expect(recovered.counts()).toMatchObject({ reserved: 0, messages: stage === 'baseline' ? 0 : 1,
      sent: stage === 'sent' ? 1 : 0, delivery_unknown: stage === 'sent' || stage === 'baseline' ? 0 : 1 });
    if (stage !== 'baseline') expect(recovered.recordMessage('synthetic-next', 'parsed', [match])).toEqual([]);
  });
it('rolls back incomplete WAL transaction after abrupt process death', () => {
  const path = file(), store = open(path); store.baseline('100', 1000); store.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec(\"BEGIN IMMEDIATE;INSERT INTO messages VALUES('synthetic-crash','parsed',0);INSERT INTO projects VALUES('123','match','[]','reserved');\");process.exit(43);", path],
    { encoding: 'utf8', timeout: 10_000 });
  expect(child.status).toBe(43); const recovered = open(path);
  expect(recovered.counts()).toMatchObject({ messages: 0, reserved: 0, delivery_unknown: 0 });
});
it('fails closed under SQLITE_BUSY without reserving a message or project', () => {
  const path = file(), store = open(path), competing = new DatabaseSync(path); competing.exec('BEGIN IMMEDIATE');
  try { expect(() => store.recordMessage('synthetic-a', 'parsed', [match])).toThrow('storage_error'); }
  finally { competing.exec('ROLLBACK'); competing.close(); }
  expect(store.counts()).toMatchObject({ messages: 0, reserved: 0 });
});
it('does not authorize a send if the independent guard cannot be updated after SQL commit', () => {
  const path = file(), store = open(path);
  unlinkSync(path + '.guard.json'); mkdirSync(path + '.guard.json');
  expect(() => store.recordMessage('synthetic-a', 'parsed', [match])).toThrow('storage_error');
  expect(store.counts()).toMatchObject({ messages: 1, reserved: 1 });
});
it('recovers DB-ahead-of-guard after a commit/update interruption without losing reservations', () => {
  const path = file(), store = open(path); const olderGuard = readFileSync(path + '.guard.json');
  store.recordMessage('synthetic-a', 'parsed', [match]); store.close();
  writeFileSync(path + '.guard.json', olderGuard);
  expect(open(path).counts()).toMatchObject({ delivery_unknown: 1, reserved: 0 });
});
