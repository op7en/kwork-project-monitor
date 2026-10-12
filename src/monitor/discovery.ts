import type { MonitoringGmail } from '../gmail/monitorClient.js';
export const MONITOR_LIMITS = { maxPages: 10, maxMessages: 100, maxProjects: 200, maxSends: 10 } as const;
export type MonitorLimits = { [K in keyof typeof MONITOR_LIMITS]: number };
export class DiscoveryError extends Error {
  constructor(readonly status: 'discovery_overflow' | 'discovery_error') { super(status); }
}
const validHistory = (id: string) => /^[1-9]\d{0,39}$/.test(id);
/** No timestamp cursor, no truncated result. Never returns IDs from an incomplete enumeration. */
export async function collectHistory(client: MonitoringGmail, start: string, upper: string,
  limits: MonitorLimits = MONITOR_LIMITS, allowed: () => boolean = () => true): Promise<string[]> {
  if (!validHistory(start) || !validHistory(upper) || BigInt(upper) < BigInt(start)) throw new DiscoveryError('discovery_error');
  if (upper === start) return [];
  const ids = new Set<string>(), tokens = new Set<string>();
  let token: string | undefined;
  for (let pageNumber = 0; pageNumber < limits.maxPages; pageNumber++) {
    if (!allowed()) return []; // caller rechecks cancellation before cursor movement
    const page = await client.historyPage(start, token);
    if (!validHistory(page.historyId) || BigInt(page.historyId) < BigInt(upper)) throw new DiscoveryError('discovery_error');
    if (page.records.length > 100) throw new DiscoveryError('discovery_overflow');
    for (const record of page.records) {
      if (!validHistory(record.historyId)) throw new DiscoveryError('discovery_error');
      if (BigInt(record.historyId) <= BigInt(start) || BigInt(record.historyId) > BigInt(upper)) continue;
      for (const id of record.messageIds) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new DiscoveryError('discovery_error');
        ids.add(id);
        if (ids.size > limits.maxMessages) throw new DiscoveryError('discovery_overflow');
      }
    }
    token = page.nextPageToken;
    if (!token) return [...ids];
    if (token.length > 2048 || tokens.has(token)) throw new DiscoveryError('discovery_error');
    tokens.add(token);
  }
  throw new DiscoveryError('discovery_overflow');
}
