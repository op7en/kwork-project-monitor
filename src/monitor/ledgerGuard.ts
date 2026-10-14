import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface LedgerGuard { epoch: string; revision: string }
/** Independent high-water mark. No message/project identifiers or payloads. */
export function readLedgerGuard(path: string): LedgerGuard | undefined {
  if (!existsSync(path)) return undefined;
  if (statSync(path).size > 512) throw Error('storage_error');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || !('epoch' in value) || !('revision' in value) ||
      typeof value.epoch !== 'string' || !/^[a-f0-9-]{36}$/.test(value.epoch) ||
      typeof value.revision !== 'string' || !/^\d{1,40}$/.test(value.revision)) throw Error('storage_error');
  return { epoch: value.epoch, revision: value.revision };
}
export function writeLedgerGuard(path: string, value: LedgerGuard): void {
  const temporary = path + '.' + randomUUID() + '.tmp';
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
    for (let attempt = 0; ; attempt++) {
      try { renameSync(temporary, path); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows scanners may briefly hold the destination. Retry only the atomic rename,
        // never a DB transaction/send, and never unlink the independently retained guard.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(code ?? '') || attempt >= 9) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
