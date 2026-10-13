import { lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readLedgerGuard } from '../monitor/ledgerGuard.js';

export class DeploymentStateError extends Error {}
// Version1 writer uses positional INSERTs. Count/order/types/nullability/PK are part of its contract.
const schema = {
  meta: [['key', 'TEXT', 1, 1], ['value', 'TEXT', 1, 0]],
  session: [['singleton', 'INTEGER', 0, 1], ['owner', 'TEXT', 1, 0], ['pid', 'INTEGER', 1, 0], ['host', 'TEXT', 1, 0]],
  messages: [['id', 'TEXT', 1, 1], ['outcome', 'TEXT', 1, 0], ['attempts', 'INTEGER', 1, 0]],
  projects: [['id', 'TEXT', 1, 1], ['classification', 'TEXT', 1, 0], ['reasons', 'TEXT', 1, 0], ['state', 'TEXT', 1, 0]],
} as const;

/** Deployment/transfer gate only. Never acquires a session, initializes or repairs M5 storage.
 * The writer must be stopped independently; this check is not a cross-host singleton lock.
 * SQLite may create WAL/SHM bookkeeping on a writable mount, but ledger/guard are read-only.
 */
export function checkDeploymentState(directory: string, expectedBinding?: string): void {
  const path = join(directory, 'monitor.sqlite'), guardPath = path + '.guard.json';
  let db: DatabaseSync | undefined;
  try {
    if (!existsSync(path) || !existsSync(guardPath)) throw new DeploymentStateError('deployment_state_missing');
    if (!lstatSync(directory).isDirectory() || !lstatSync(path).isFile() || !lstatSync(guardPath).isFile() ||
        lstatSync(path).size === 0) throw new DeploymentStateError('deployment_state_invalid');
    const guard = readLedgerGuard(guardPath);
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
    if (db.prepare('PRAGMA quick_check').get()?.['quick_check'] !== 'ok' ||
        db.prepare('PRAGMA user_version').get()?.['user_version'] !== 1) throw new DeploymentStateError('deployment_state_invalid');
    const tables = db.prepare('PRAGMA table_list').all();
    for (const [table, columns] of Object.entries(schema)) {
      const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => [row['name'], row['type'], row['notnull'], row['pk']]);
      if (JSON.stringify(actual) !== JSON.stringify(columns) ||
          !tables.some(row => row['schema'] === 'main' && row['name'] === table && row['type'] === 'table' && row['strict'] === 1))
        throw new DeploymentStateError('deployment_state_invalid');
    }
    const meta = (key: string) => db!.prepare('SELECT value FROM meta WHERE key=?').get(key)?.['value'];
    const epoch = meta('epoch'), revision = meta('revision');
    if (!guard || epoch !== guard.epoch || revision !== guard.revision) throw new DeploymentStateError('deployment_state_invalid');
    const history = meta('history'), floor = meta('floor');
    if (typeof history !== 'string' || !/^[1-9]\d{0,39}$/.test(history) ||
        typeof floor !== 'string' || !/^\d+$/.test(floor) || !Number.isSafeInteger(Number(floor)))
      throw new DeploymentStateError('deployment_baseline_missing');
    const binding = meta('binding');
    if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)) throw new DeploymentStateError('deployment_state_invalid');
    if (expectedBinding !== undefined && binding !== expectedBinding) throw new DeploymentStateError('deployment_binding_mismatch');
    if (db.prepare('SELECT count(*) AS n FROM session').get()?.['n'] !== 0) throw new DeploymentStateError('deployment_state_busy');
    // Ensure both persistent outcome tables are readable without enumerating private identities.
    db.prepare('SELECT count(*) FROM messages').get(); db.prepare('SELECT count(*) FROM projects').get();
  } catch (error: unknown) {
    throw error instanceof DeploymentStateError ? error : new DeploymentStateError('deployment_state_invalid');
  } finally {
    try { db?.close(); } catch { /* Do not override a fixed validation error with a raw SQLite error. */ }
  }
}

/** Compare a validated candidate with an independently retained CURRENT high-water mark.
 * A consistent old DB+guard pair alone cannot prove that later tombstones were preserved.
 */
export function checkRestoreGuard(directory: string, retainedGuardPath: string): void {
  try {
    const candidate = readLedgerGuard(join(directory, 'monitor.sqlite.guard.json'));
    const current = readLedgerGuard(retainedGuardPath);
    if (!candidate || !current || candidate.epoch !== current.epoch || BigInt(candidate.revision) < BigInt(current.revision))
      throw new DeploymentStateError('deployment_restore_refused');
  } catch {
    throw new DeploymentStateError('deployment_restore_refused');
  }
}
