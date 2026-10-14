import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FilterDecision } from '../filters/projectFilter.js';
import { readLedgerGuard, writeLedgerGuard } from './ledgerGuard.js';
import { safeErrorDetails, type SafeErrorDetails } from '../gmail/client.js';
export class StorageError extends Error {
  readonly diagnostic: SafeErrorDetails;
  constructor(readonly code = 'storage_error', error?: unknown, stage = 'storage') {
    super(code); this.name = 'StorageError'; this.diagnostic = safeErrorDetails(error ?? this, stage);
  }
}
// PID reuse recovery must not let another store in this process steal a live session.
const openStores = new Set<string>();
export const HISTORY_ID = /^[1-9]\d{0,39}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export type MessageOutcome = 'parsed' | 'parse_failed' | 'rejected' | 'historical';
export interface Cursor { historyId: string; floor: number }
export interface StoredDecision extends FilterDecision { projectId: string }
export interface StateCounts { messages: number; sent: number; reserved: number; delivery_unknown: number; filtered: number; review: number; exclude: number }
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error: unknown) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
};
/** Local single-host ledger, no mail/project payloads. Reservation is durable BEFORE external send. */
export class MonitorStore {
  private db!: DatabaseSync;
  private closed = false;
  private readonly owner = randomUUID();
  private readonly guardPath: string;
  private readonly pathKey: string;
  constructor(path: string, binding: string) {
    this.guardPath = path + '.guard.json';
    this.pathKey = process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    try {
      if (openStores.has(this.pathKey)) throw new StorageError('storage_busy');
      if (!binding || path.startsWith('\\\\')) throw new StorageError();
      const existed = existsSync(path);
      const guard = readLedgerGuard(this.guardPath);
      if (existed !== (guard !== undefined)) throw new StorageError();
      if (existed && statSync(path).size === 0) throw new StorageError();
      mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(path);
      this.db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA max_page_count=16384');
      if (this.db.prepare('PRAGMA quick_check').get()?.['quick_check'] !== 'ok') throw new StorageError();
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get()?.['user_version'];
        if (version === 0) {
          if (existed) throw new StorageError();
          if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) throw new StorageError();
          this.db.exec(`
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
            CREATE TABLE session (singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL) STRICT;
            CREATE TABLE messages (id TEXT PRIMARY KEY, outcome TEXT NOT NULL CHECK(outcome IN ('retry','read_failed','parsed','parse_failed','rejected','historical')), attempts INTEGER NOT NULL) STRICT;
            CREATE TABLE projects (id TEXT PRIMARY KEY, classification TEXT NOT NULL CHECK(classification IN ('match','review','exclude')),
              reasons TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('filtered','reserved','sent','delivery_unknown'))) STRICT;
            PRAGMA user_version=1;
          `);
          this.db.prepare('INSERT INTO meta VALUES (?, ?)').run('binding', binding);
          this.db.prepare('INSERT INTO meta VALUES (?, ?)').run('epoch', randomUUID());
          this.db.prepare('INSERT INTO meta VALUES (?, ?)').run('revision', '0');
        } else if (version !== 1) throw new StorageError();
        if (this.db.prepare("SELECT value FROM meta WHERE key='binding'").get()?.['value'] !== binding) throw new StorageError();
        const current = this.guardValue();
        const lag = guard ? BigInt(current.revision) - BigInt(guard.revision) : 0n;
        // Exactly one committed transaction may be missing its sidecar update; larger gaps are not recovery.
        if (guard && (guard.epoch !== current.epoch || lag < 0n || lag > 1n)) throw new StorageError();
        const session = this.db.prepare('SELECT pid,host FROM session').get();
        if (session && (session['host'] !== hostname() || typeof session['pid'] !== 'number' ||
            (session['pid'] !== process.pid && alive(session['pid']))))
          throw new StorageError('storage_busy');
        // current already belongs to the committed DB. Repair before our next revision, so a second crash
        // cannot turn the allowed one-step gap into two. No uncommitted revision is published here.
        if (guard && lag === 1n) writeLedgerGuard(this.guardPath, current);
        this.db.exec("DELETE FROM session; UPDATE projects SET state='delivery_unknown' WHERE state='reserved'");
        this.db.prepare('INSERT INTO session VALUES (1, ?, ?, ?)').run(this.owner, process.pid, hostname());
      });
      openStores.add(this.pathKey);
    } catch (error) {
      try { this.db?.close(); } catch { /* no raw errors */ }
      throw error instanceof StorageError ? error : new StorageError('storage_error', error, 'storage_open');
    }
  }
  private transaction<T>(work: () => T): T {
    try {
      if (this.closed) throw new StorageError();
      this.db.exec('BEGIN IMMEDIATE');
      const result = work();
      const guard = this.guardValue();
      guard.revision = String(BigInt(guard.revision) + 1n);
      this.db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(guard.revision);
      this.db.exec('COMMIT');
      // This must finish BEFORE recordMessage returns permission to attempt an external send.
      writeLedgerGuard(this.guardPath, guard);
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no raw errors */ }
      throw error instanceof StorageError ? error : new StorageError('storage_error', error, 'storage_transaction');
    }
  }
  private guardValue() {
    const epoch = this.db.prepare("SELECT value FROM meta WHERE key='epoch'").get()?.['value'];
    const revision = this.db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.['value'];
    if (typeof epoch !== 'string' || !/^[a-f0-9-]{36}$/.test(epoch) ||
        typeof revision !== 'string' || !/^\d{1,40}$/.test(revision)) throw new StorageError();
    return { epoch, revision };
  }
  private safe<T>(work: () => T): T {
    try { if (this.closed) throw new StorageError(); return work(); }
    catch (error) { throw error instanceof StorageError ? error : new StorageError('storage_error', error, 'storage_read'); }
  }
  enabled(): boolean {
    return this.safe(() => {
      const value = this.db.prepare("SELECT value FROM meta WHERE key='enabled'").get()?.['value'];
      if (value !== undefined && value !== '0' && value !== '1') throw new StorageError();
      return value === '1';
    });
  }
  setEnabled(value: boolean): void {
    this.transaction(() => {
      if (typeof value !== 'boolean') throw new StorageError();
      this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('enabled', value ? '1' : '0');
    });
  }
  cursor(): Cursor | undefined {
    return this.safe(() => {
      const historyId = this.db.prepare("SELECT value FROM meta WHERE key='history'").get()?.['value'];
      if (historyId === undefined) return undefined;
      const floor = Number(this.db.prepare("SELECT value FROM meta WHERE key='floor'").get()?.['value']);
      if (typeof historyId !== 'string' || !HISTORY_ID.test(historyId) || !Number.isSafeInteger(floor) || floor < 0) throw new StorageError();
      return { historyId, floor };
    });
  }
  baseline(historyId: string, floor: number, replace = false): void {
    this.transaction(() => {
      if (!HISTORY_ID.test(historyId) || !Number.isSafeInteger(floor) || floor < 0) throw new StorageError();
      if (this.cursor() && !replace) throw new StorageError();
      const set = this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)');
      set.run('history', historyId); set.run('floor', String(floor));
    });
  }
  checkpoint(historyId: string): void {
    this.transaction(() => {
      const cursor = this.cursor();
      if (!cursor || !HISTORY_ID.test(historyId) || BigInt(historyId) < BigInt(cursor.historyId)) throw new StorageError();
      this.db.prepare("UPDATE meta SET value=? WHERE key='history'").run(historyId);
    });
  }
  hasMessage(id: string): boolean {
    return this.safe(() => {
      const outcome = this.db.prepare('SELECT outcome FROM messages WHERE id=?').get(id)?.['outcome'];
      return outcome !== undefined && outcome !== 'retry';
    });
  }
  hasProject(id: string): boolean {
    return this.safe(() => !!this.db.prepare('SELECT id FROM projects WHERE id=?').get(id));
  }
  private capacity(): void {
    const row = this.db.prepare('SELECT (SELECT count(*) FROM messages) AS m,(SELECT count(*) FROM projects) AS p').get()!;
    if (Number(row['m']) >= 100_000 || Number(row['p']) >= 100_000) throw new StorageError();
  }
  readFailure(id: string): boolean {
    return this.transaction(() => {
      if (!MESSAGE_ID.test(id)) throw new StorageError();
      this.capacity();
      this.db.prepare(`INSERT INTO messages VALUES (?, 'retry', 1)
        ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 WHERE outcome='retry'`).run(id);
      this.db.prepare("UPDATE messages SET outcome='read_failed' WHERE id=? AND attempts>=3 AND outcome='retry'").run(id);
      return this.hasMessage(id);
    });
  }
  recordMessage(id: string, outcome: MessageOutcome, decisions: StoredDecision[] = []): string[] {
    return this.transaction(() => {
      if (!MESSAGE_ID.test(id)) throw new StorageError();
      if (this.hasMessage(id)) return [];
      this.capacity();
      const reserved: string[] = [];
      for (const entry of decisions) {
        if (!/^[1-9]\d{0,79}$/.test(entry.projectId)) throw new StorageError();
        const state = entry.classification === 'exclude' ? 'filtered' : 'reserved';
        const inserted = this.db.prepare('INSERT OR IGNORE INTO projects VALUES (?, ?, ?, ?)').run(
          entry.projectId, entry.classification, JSON.stringify(entry.reasons), state);
        if (state === 'reserved' && inserted.changes === 1) reserved.push(entry.projectId);
      }
      this.db.prepare('INSERT INTO messages VALUES (?, ?, 0) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome').run(id, outcome);
      return reserved;
    });
  }
  settle(id: string, state: 'sent' | 'delivery_unknown'): void {
    this.transaction(() => {
      const changed = this.db.prepare("UPDATE projects SET state=? WHERE id=? AND state='reserved'").run(state, id).changes;
      if (changed !== 1) throw new StorageError();
    });
  }
  counts(): StateCounts {
    return this.safe(() => {
      const counts: StateCounts = { messages: 0, sent: 0, reserved: 0, delivery_unknown: 0, filtered: 0, review: 0, exclude: 0 };
      counts.messages = Number(this.db.prepare('SELECT count(*) AS n FROM messages').get()?.['n']);
      for (const row of this.db.prepare('SELECT state,count(*) AS n FROM projects GROUP BY state').all()) {
        const state = row['state'];
        if (state === 'sent' || state === 'reserved' || state === 'delivery_unknown' || state === 'filtered') counts[state] = Number(row['n']);
      }
      for (const row of this.db.prepare('SELECT classification,count(*) AS n FROM projects GROUP BY classification').all()) {
        if (row['classification'] === 'review' || row['classification'] === 'exclude') counts[row['classification']] = Number(row['n']);
      }
      return counts;
    });
  }
  close(): void {
    if (this.closed) return;
    try {
      try { this.db.prepare('DELETE FROM session WHERE owner=?').run(this.owner); }
      finally { this.closed = true; try { this.db.close(); } finally { openStores.delete(this.pathKey); } }
    } catch (error) { throw new StorageError('storage_error', error, 'storage_close'); }
  }
}
