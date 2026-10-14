import type { MonitoringGmail } from '../gmail/monitorClient.js';
import { GmailError, safeErrorDetails, type SafeErrorDetails } from '../gmail/client.js';
import { parseGmailMessage } from '../gmail/projects.js';
import { KWORK_TABLE_POLICY } from '../kwork/parser.js';
import { classifyProject } from '../filters/projectFilter.js';
import type { createProjectNotifier } from '../bot/projectNotifications.js';
import { MonitorStore, StorageError } from './store.js';
import { collectHistory, DiscoveryError, MONITOR_LIMITS, type MonitorLimits } from './discovery.js';
import type { Diagnostic } from '../kwork/model.js';
const FATAL_DIAGNOSTICS: ReadonlySet<Diagnostic> = new Set([
  'invalid_payload', 'empty_body', 'attachment_required', 'unsupported_mime', 'invalid_base64url',
  'unsupported_charset', 'invalid_text', 'message_limit', 'mime_limit', 'unconfirmed_policy', 'html_limit', 'no_project_blocks',
]);
export interface PassResult {
  status: 'initialized' | 'completed' | 'partial' | 'stopped' | 'busy' | 'destination_unconfirmed' |
    'gmail_error' | 'gmail_access_error' | 'storage_error' | 'history_expired' | 'discovery_error' | 'discovery_overflow' | 'delivery_limit' | 'baseline_exists' | 'acceptance_rejected';
  messages: number; found: number; match: number; review: number; exclude: number; sent: number; unknown: number; parseFailed: number;
  diagnostic?: SafeErrorDetails;
}
interface PassOptions {
  store: MonitorStore;
  notifier: Pick<ReturnType<typeof createProjectNotifier>, 'hasConfirmedDestination' | 'send'>;
  connect: (floor: number | undefined, allowed: () => boolean) => Promise<MonitoringGmail>;
  now?: () => number;
  limits?: MonitorLimits;
  selectedMessageId?: string;
}
export function createMonitoringPass(options: PassOptions) {
  const { store, notifier, connect } = options;
  const limits = options.limits ?? MONITOR_LIMITS;
  let running = false;
  return { async run(allowed: () => boolean = () => true, resetBaseline = false, confirmReset = false): Promise<PassResult> {
    const result: PassResult = { status: 'completed', messages: 0, found: 0, match: 0, review: 0,
      exclude: 0, sent: 0, unknown: 0, parseFailed: 0 };
    const done = (status: PassResult['status']) => ({ ...result, status });
    if (running) return done('busy');
    if (!notifier.hasConfirmedDestination()) return done('destination_unconfirmed');
    if (!allowed()) return done('stopped');
    running = true;
    try {
      const cursor = store.cursor();
      if (cursor && resetBaseline && !confirmReset) return done('baseline_exists');
      // Capture BEFORE the asynchronous history snapshot: later arrivals must not become historical.
      const activationTime = (options.now ?? Date.now)();
      const client = await connect(cursor?.floor, allowed);
      if (!allowed()) return done('stopped');
      const upper = await client.currentHistoryId();
      if (!allowed()) return done('stopped');
      if (!cursor || resetBaseline) {
        store.baseline(upper, activationTime, resetBaseline);
        return done('initialized');
      }
      const ids = await collectHistory(client, cursor.historyId, upper, limits, allowed);
      if (!allowed()) return done('stopped');
      if (options.selectedMessageId !== undefined && (ids.length !== 1 || ids[0] !== options.selectedMessageId))
        return done('acceptance_rejected');
      let attempts = 0;
      for (const id of ids) {
        if (!allowed()) return done('stopped');
        if (store.hasMessage(id)) continue;
        // A started digest is indivisible. The soft send budget only defers the next unread message.
        if (attempts >= limits.maxSends) return done('partial');
        let read: Awaited<ReturnType<MonitoringGmail['reader']['getProjectMessage']>>;
        try { read = await client.reader.getProjectMessage(id); }
        catch (error) {
          result.diagnostic = safeErrorDetails(error, 'message_read');
          if (!allowed()) return done('stopped');
          if (isAccessError(error)) throw error;
          if (!store.readFailure(id)) return done('partial');
          result.messages++; continue;
        }
        if (!allowed() || read.diagnostics.includes('operation_cancelled')) return done('stopped');
        if (!read.message) {
          store.recordMessage(id, read.diagnostics.includes('historical_message') ? 'historical' : 'rejected');
          result.messages++; continue;
        }
        const parsed = parseGmailMessage(read.message, KWORK_TABLE_POLICY);
        if (options.selectedMessageId !== undefined && parsed.projects.length > 1) return done('acceptance_rejected');
        if (!parsed.projects.length || parsed.diagnostics.some(code => FATAL_DIAGNOSTICS.has(code))) {
          store.recordMessage(id, 'parse_failed'); result.parseFailed++; result.messages++; continue;
        }
        if (result.found + parsed.projects.length > limits.maxProjects) return done(result.messages ? 'partial' : 'delivery_limit');
        const classified = parsed.projects.map(project => ({ project, decision: classifyProject(project) }));
        const eligible = classified.filter(({ project, decision }) => decision.classification !== 'exclude' && !store.hasProject(project.projectId));
        const reservations = new Set(store.recordMessage(id, 'parsed', classified.map(({ project, decision }) =>
          ({ projectId: project.projectId, ...decision }))));
        result.messages++; result.found += parsed.projects.length;
        for (const { decision } of classified) result[decision.classification]++;
        for (const { project, decision } of eligible) {
          if (!reservations.has(project.projectId)) continue;
          if (!allowed()) { store.settle(project.projectId, 'delivery_unknown'); result.unknown++; continue; }
          attempts++;
          let sent = false;
          try { sent = (await notifier.send(project, decision)).status === 'sent'; } catch { /* ambiguity: never retry */ }
          store.settle(project.projectId, sent ? 'sent' : 'delivery_unknown');
          if (sent) result.sent++; else result.unknown++;
        }
      }
      if (!allowed()) return done('stopped');
      store.checkpoint(upper);
      return result;
    } catch (error) {
      result.diagnostic = error instanceof StorageError ? error.diagnostic : safeErrorDetails(error, 'monitor_pass');
      if (error instanceof StorageError) return done('storage_error');
      if (!allowed()) return done('stopped');
      if (error instanceof DiscoveryError) return done(error.status);
      if (error instanceof GmailError) {
        if (error.category === 'history_expired') return done('history_expired');
        if (isAccessError(error)) return done('gmail_access_error');
      }
      return done('gmail_error');
    } finally { running = false; }
  } };
}
function isAccessError(error: unknown): boolean {
  return error instanceof GmailError && (['invalid_grant', 'invalid_client', 'access_denied', 'insufficient_scope',
    'unsafe_gmail_scope', 'account_mismatch'].includes(error.category) || error.httpStatus === 401 || error.httpStatus === 403);
}
