import type { createMonitoringPass, PassResult } from './pass.js';
import { StorageError, type MonitorStore, type StateCounts } from './store.js';
interface Resources { pass: Pick<ReturnType<typeof createMonitoringPass>, 'run'>; store: Pick<MonitorStore, 'counts' | 'close'> }
export type MonitorResult = PassResult | { status: 'disabled' | 'closed' | 'already_enabled' | 'busy' |
  'destination_unconfirmed' | 'configuration_error' | 'storage_error' };
const PAUSE = new Set(['storage_error', 'gmail_access_error', 'history_expired', 'discovery_error', 'discovery_overflow', 'delivery_limit', 'configuration_error']);
const emptyCounts = (): StateCounts => ({ messages: 0, sent: 0, reserved: 0, filtered: 0, delivery_unknown: 0, review: 0, exclude: 0 });

/** Memory-only opt-in. The same operation is used by command and timer; no startup or persisted activation. */
export function createMonitorController(notifier: { hasConfirmedDestination(): boolean },
  create: () => Resources, intervalMs: number, report: (result: MonitorResult) => void = () => {}) {
  let resources: Resources | undefined;
  let enabled = false, closed = false, generation = 0;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<MonitorResult> | undefined;
  let lastStatus: MonitorResult['status'] = 'disabled';
  let lastCompletedAt: number | null = null, nextAttemptAt: number | null = null;
  let lastErrorCategory: MonitorResult['status'] | null = null;
  const disable = () => { enabled = false; generation++; clearTimeout(timer); timer = undefined; nextAttemptAt = null; };
  const execute = async (reset = false, confirmReset = false): Promise<MonitorResult> => {
    if (closed) return { status: 'closed' };
    if (active) return { status: 'busy' };
    if (!reset && !enabled) return { status: 'disabled' };
    if (!notifier.hasConfirmedDestination()) { disable(); return { status: 'destination_unconfirmed' }; }
    clearTimeout(timer); timer = undefined; nextAttemptAt = null;
    const epoch = generation;
    const allowed = () => !closed && generation === epoch && (reset ? !enabled : enabled) && notifier.hasConfirmedDestination();
    active = Promise.resolve().then(async (): Promise<MonitorResult> => {
      if (!allowed()) return { status: 'disabled' };
      try {
        resources ??= create();
        return await resources.pass.run(allowed, reset, confirmReset);
      } catch (error) {
        return { status: error instanceof StorageError ? 'storage_error' : 'configuration_error' };
      }
    });
    try {
      const result = await active;
      lastStatus = result.status;
      lastCompletedAt = Date.now();
      if (PAUSE.has(result.status) || result.status === 'gmail_error' || result.status === 'partial') lastErrorCategory = result.status;
      else if (result.status === 'completed' || result.status === 'initialized') lastErrorCategory = null;
      if (PAUSE.has(result.status)) disable();
      report(result);
      return result;
    } finally {
      active = undefined;
      if (enabled && !closed) {
        nextAttemptAt = Date.now() + intervalMs;
        timer = setTimeout(() => { void execute(); }, intervalMs);
      }
    }
  };
  return {
    async on(): Promise<MonitorResult> {
      if (closed) return { status: 'closed' };
      if (active) return { status: 'busy' };
      if (enabled) return { status: 'already_enabled' };
      if (!notifier.hasConfirmedDestination()) return { status: 'destination_unconfirmed' };
      enabled = true; return execute();
    },
    async off(): Promise<void> { disable(); await active; },
    run: (): Promise<MonitorResult> => execute(),
    async baseline(confirmReset = false): Promise<MonitorResult> {
      if (enabled || active) return { status: 'busy' };
      return execute(true, confirmReset);
    },
    status() {
      let counts = emptyCounts();
      try { counts = closed ? counts : resources?.store.counts() ?? counts; }
      catch { disable(); lastStatus = 'storage_error'; lastErrorCategory = 'storage_error'; }
      return { enabled, running: active !== undefined, storageOpen: resources !== undefined && !closed, lastStatus,
        lastCompletedAt, nextAttemptAt, lastErrorCategory, blocked: lastErrorCategory !== null && PAUSE.has(lastErrorCategory), counts };
    },
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true; disable(); await active;
      try { resources?.store.close(); } catch { lastStatus = 'storage_error'; report({ status: 'storage_error' }); }
    },
  };
}
export type MonitorController = ReturnType<typeof createMonitorController>;
