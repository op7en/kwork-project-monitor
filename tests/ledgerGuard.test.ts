import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeLedgerGuard } from '../src/monitor/ledgerGuard.js';

const fault = vi.hoisted(() => ({ remaining: 0, calls: 0, code: 'EPERM' }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, renameSync: (...args: Parameters<typeof fs.renameSync>) => {
    fault.calls++;
    if (fault.remaining-- > 0) throw Object.assign(new Error('synthetic rename failure'), { code: fault.code });
    return fs.renameSync(...args);
  } };
});
const dirs: string[] = [];
afterEach(() => { fault.remaining = 0; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const guard = { epoch: '00000000-0000-0000-0000-000000000000', revision: '1' };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kwork-guard-retry-')); dirs.push(dir);
  const path = join(dir, 'guard.json'); writeLedgerGuard(path, guard); fault.calls = 0; return path;
}
it.skipIf(process.platform !== 'win32').each(['EPERM', 'EACCES'])('retries a transient Windows %s replacing only the guard', code => {
  const path = fixture(); fault.code = code; fault.remaining = 2;
  writeLedgerGuard(path, { ...guard, revision: '2' });
  expect(fault.calls).toBe(3); expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...guard, revision: '2' });
});
it.skipIf(process.platform !== 'win32')('bounds permanent Windows rename failure and preserves the current guard', () => {
  const path = fixture(); fault.code = 'EPERM'; fault.remaining = 100;
  expect(() => writeLedgerGuard(path, { ...guard, revision: '2' })).toThrow('synthetic rename failure');
  expect(fault.calls).toBe(10); expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(guard);
});
it('does not retry unrelated I/O failures or remove the current guard', () => {
  const path = fixture(); fault.code = 'ENOSPC'; fault.remaining = 1;
  expect(() => writeLedgerGuard(path, { ...guard, revision: '2' })).toThrow('synthetic rename failure');
  expect(fault.calls).toBe(1); expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(guard);
});
