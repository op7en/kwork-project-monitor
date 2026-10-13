import { lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readLedgerGuard } from '../monitor/ledgerGuard.js';

export class DeploymentStateError extends Error {}

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
