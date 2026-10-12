import { createMonitoringPass } from './pass.js';
import { StorageError } from './store.js';
import { MONITOR_LIMITS } from './discovery.js';

/** Single process/run, no scheduler. Uses the production ledger, reader and notifier. */
export function createAcceptancePass(options: Parameters<typeof createMonitoringPass>[0], selectedMessageId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(selectedMessageId)) throw Error('acceptance_configuration_error');
  let used = false;
  const pass = createMonitoringPass({ ...options, selectedMessageId,
    limits: { ...MONITOR_LIMITS, maxMessages: 1, maxSends: 1 } });
  return { async run(allowed: () => boolean = () => true) {
    if (used) return { status: 'acceptance_used' as const };
    if (!options.notifier.hasConfirmedDestination()) return { status: 'destination_unconfirmed' as const };
    if (!allowed()) return { status: 'stopped' as const };
    used = true; // Reserve the entire run BEFORE the first await, including failures/empty runs.
    try {
      if (!options.store.cursor()) return { status: 'acceptance_baseline_required' as const };
      return await pass.run(allowed);
    } catch (error) {
      return { status: error instanceof StorageError ? 'storage_error' as const : 'acceptance_error' as const };
    }
  } };
}
