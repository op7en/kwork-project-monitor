import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { createProjectNotifier } from '../bot/projectNotifications.js';
import { loadGmailConfig } from '../config/gmail.js';
import { loadMonitorConfig } from '../config/monitor.js';
import { createGmailMonitoringClient } from '../gmail/client.js';
import { MonitorStore } from './store.js';
import { createMonitoringPass } from './pass.js';
import { createMonitorController } from './controller.js';
/** Construction is inert. Startup restore opens only an existing bound ledger; owner activation can initialize one. */
export function createMonitorRuntime(notifier: ReturnType<typeof createProjectNotifier>, ownerId: number,
  env: NodeJS.ProcessEnv = process.env) {
  const { intervalMs, limits } = loadMonitorConfig(env);
  return createMonitorController(notifier, () => {
    const { config, store } = openMonitorStore(ownerId, env);
    return { store, pass: createMonitoringPass({ store, notifier, limits,
      connect: (floor, allowed) => createGmailMonitoringClient(config, floor, allowed) }) };
  }, intervalMs, result => { console.info(JSON.stringify({ event: 'monitor_result', ...result })); },
  () => existsSync(join(process.cwd(), '.local-state', 'monitor.sqlite')) ||
    existsSync(join(process.cwd(), '.local-state', 'monitor.sqlite.guard.json')));
}
/** Shared ledger path/binding for production and controlled acceptance, not a second database. */
export function openMonitorStore(ownerId: number, env: NodeJS.ProcessEnv = process.env) {
  const config = loadGmailConfig(env);
  const binding = createHash('sha256').update(config.expectedAccountEmail.trim().toLowerCase() + ':' + ownerId).digest('hex');
  const store = new MonitorStore(join(process.cwd(), '.local-state', 'monitor.sqlite'), binding);
  return { config, store };
}
