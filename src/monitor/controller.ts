import type { createMonitoringPass, PassResult } from './pass.js';
import { StorageError, type MonitorStore, type StateCounts } from './store.js';
import { safeErrorDetails, type SafeErrorDetails } from '../gmail/client.js';
import type { createProjectNotifier } from '../bot/projectNotifications.js';
interface Resources {
  pass: Pick<ReturnType<typeof createMonitoringPass>, 'run'>;
  store: Pick<MonitorStore, 'counts' | 'close' | 'cursor' | 'enabled' | 'setEnabled'>;
}
export type MonitorResult = PassResult | { status: 'disabled' | 'closed' | 'already_enabled' | 'busy' |
  'destination_unconfirmed' | 'configuration_error' | 'storage_error'; diagnostic?: SafeErrorDetails };
const PAUSE = new Set(['storage_error', 'gmail_access_error', 'history_expired', 'discovery_error', 'discovery_overflow', 'delivery_limit', 'configuration_error']);
const pauseReasons: Record<string, string> = {
  storage_error: 'ошибка локального хранилища', gmail_access_error: 'нет доступа к Gmail',
  history_expired: 'история Gmail недоступна: срок хранения cursor истёк', discovery_error: 'ошибка чтения истории Gmail',
  discovery_overflow: 'превышен предел обнаружения писем', delivery_limit: 'превышен предел обработки проектов',
  configuration_error: 'ошибка конфигурации',
};
const emptyCounts = (): StateCounts => ({ messages: 0, sent: 0, reserved: 0, filtered: 0, delivery_unknown: 0, review: 0, exclude: 0 });

/** Private-owner opt-in is persisted; shutdown drains work without clearing that intent. */
export function createMonitorController(
  notifier: Pick<ReturnType<typeof createProjectNotifier>, 'hasConfirmedDestination' | 'restoreConfirmedDestination' | 'sendAlert'>,
  create: () => Resources, intervalMs: number, report: (result: MonitorResult) => void = () => {},
  hasState: () => boolean = () => false,
) {
  let resources: Resources | undefined;
  let enabled = false, closed = false, generation = 0;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<MonitorResult> | undefined;
  let alerting: Promise<boolean> | undefined;
  let lastStatus: MonitorResult['status'] = 'disabled';
  let lastCompletedAt: number | null = null, nextAttemptAt: number | null = null;
  let lastErrorCategory: MonitorResult['status'] | null = null;
  let alerted: MonitorResult['status'] | undefined;
  const disable = () => { enabled = false; generation++; clearTimeout(timer); timer = undefined; nextAttemptAt = null; };
  const failure = (error: unknown): MonitorResult => ({
    status: error instanceof StorageError ? 'storage_error' : 'configuration_error',
    diagnostic: error instanceof StorageError ? error.diagnostic : safeErrorDetails(error, 'monitor_control'),
  });
  const complete = async (value: MonitorResult): Promise<MonitorResult> => {
    let result = value;
    if (PAUSE.has(result.status)) {
      disable();
      try { resources?.store.setEnabled(false); }
      catch (error) { result = failure(error); }
    }
    lastStatus = result.status; lastCompletedAt = Date.now();
    if (PAUSE.has(result.status) || result.status === 'gmail_error' || result.status === 'partial') lastErrorCategory = result.status;
    else if (result.status === 'completed' || result.status === 'initialized') { lastErrorCategory = null; alerted = undefined; }
    try { report(result); } catch { /* A reporting failure must not reject a timer or interrupt draining. */ }
    if (PAUSE.has(result.status) && alerted !== result.status && !alerting && !closed && notifier.hasConfirmedDestination()) {
      alerted = result.status;
      try {
        alerting = notifier.sendAlert(`⚠️ Мониторинг Kwork остановлен: ${pauseReasons[result.status]}. Проверьте /monitor status. ` +
          (result.status === 'history_expired' ? 'Нужна проверка baseline; /monitor baseline confirm явно пропускает backlog.' :
            'После устранения причины включите /monitor on.'));
        await alerting;
      } catch { /* No recursive alerts. */ }
      finally { alerting = undefined; }
    }
    return result;
  };
  const execute = async (mode: 'run' | 'on' | 'baseline' | 'restore' = 'run', confirmReset = false): Promise<MonitorResult> => {
    if (closed) return { status: 'closed' };
    if (active) return { status: 'busy' };
    if (mode === 'run' && !enabled) return { status: 'disabled' };
    if (mode !== 'restore' && !notifier.hasConfirmedDestination()) { disable(); return { status: 'destination_unconfirmed' }; }
    clearTimeout(timer); timer = undefined; nextAttemptAt = null;
    const epoch = generation;
    const reset = mode === 'baseline';
    const allowed = () => !closed && generation === epoch && (reset ? !enabled : enabled) && notifier.hasConfirmedDestination();
    active = Promise.resolve().then(async (): Promise<MonitorResult> => {
      if (closed || generation !== epoch) return { status: 'disabled' };
      try {
        if (mode === 'restore' && !hasState()) return { status: 'disabled' };
        resources ??= create();
        if (mode === 'restore') {
          if (!resources.store.cursor() || !resources.store.enabled()) return { status: 'disabled' };
          notifier.restoreConfirmedDestination(); enabled = true;
        }
        if (!allowed()) return { status: 'disabled' };
        if (mode === 'on' && resources.store.cursor()) resources.store.setEnabled(true);
        const result = await resources.pass.run(allowed, reset, confirmReset);
        if (mode === 'on' && result.status === 'initialized' && allowed() && resources.store.cursor()) resources.store.setEnabled(true);
        return result;
      } catch (error) { return failure(error); }
    }).then(complete);
    try { return await active; }
    finally {
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
      alerted = undefined; enabled = true; return execute('on');
    },
    restore: (): Promise<MonitorResult> => enabled ? Promise.resolve({ status: 'already_enabled' }) : execute('restore'),
    async off(): Promise<void> {
      disable();
      if (closed) return;
      try {
        if (!resources && hasState()) resources = create();
        resources?.store.setEnabled(false);
      } catch (error) { await complete(failure(error)); }
      await active;
      await alerting?.catch(() => {});
    },
    run: (): Promise<MonitorResult> => execute(),
    async baseline(confirmReset = false): Promise<MonitorResult> {
      if (enabled || active) return { status: 'busy' };
      return execute('baseline', confirmReset);
    },
    status() {
      let counts = emptyCounts();
      try { counts = closed ? counts : resources?.store.counts() ?? counts; }
      catch (error) { void complete(failure(error)); }
      return { enabled, running: active !== undefined, storageOpen: resources !== undefined && !closed, lastStatus,
        lastCompletedAt, nextAttemptAt, lastErrorCategory, blocked: lastErrorCategory !== null && PAUSE.has(lastErrorCategory), counts };
    },
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true; disable(); await active; await alerting?.catch(() => {});
      try { resources?.store.close(); } catch (error) { await complete(failure(error)); }
    },
  };
}
export type MonitorController = ReturnType<typeof createMonitorController>;
