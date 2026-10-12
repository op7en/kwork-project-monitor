import type { ParseResult } from '../kwork/model.js';
import type { createProjectNotifier } from '../bot/projectNotifications.js';
import { loadGmailConfig } from '../config/gmail.js';
import { MESSAGE_ID_PATTERN } from '../config/smoke.js';
import { createGmailProjectReader } from '../gmail/client.js';
import { readKworkProjects } from '../gmail/projects.js';
import { KWORK_TABLE_POLICY } from '../kwork/parser.js';
import { printSmokeStructureDiagnostics, type SmokeStructureDiagnostics } from './structureDiagnostics.js';

export interface SmokeResult {
  status: 'sent' | 'telegram_error' | 'invalid_project' | 'invalid_message_id' | 'destination_unconfirmed' |
    'already_used' | 'gmail_error' | 'selection_mismatch' | 'no_project' | 'ambiguous_multiple_projects' | 'internal_error';
  projects: number;
  sent: 0 | 1;
  diagnostics: ParseResult['diagnostics'];
}

type Notifier = Pick<ReturnType<typeof createProjectNotifier>, 'hasConfirmedDestination' | 'send'>;

class SelectionMappingMismatchError extends Error {}

/**
 * One attempt per instance. Gates, in order: reservation → ID format → confirmed destination →
 * one reader call (scopes/account/Subject/From gates live inside the existing reader) →
 * exactly one project → one send. Any failed gate ends the run before the next external operation.
 */
export function createOneShotSmoke(notifier: Notifier, readProjects: (ids: [string]) => Promise<ParseResult>, messageId: string) {
  let used = false;
  const done = (status: SmokeResult['status'], projects = 0, diagnostics: SmokeResult['diagnostics'] = []): SmokeResult =>
    ({ status, projects, sent: status === 'sent' ? 1 : 0, diagnostics });
  return { async run(): Promise<SmokeResult> {
    // Reserve synchronously, before the first await: a concurrent or later call can never pass this point.
    if (used) return done('already_used');
    used = true;
    if (!MESSAGE_ID_PATTERN.test(messageId)) return done('invalid_message_id');
    if (!notifier.hasConfirmedDestination()) return done('destination_unconfirmed');
    let selection: ParseResult;
    try { selection = await readProjects([messageId]); }
    catch (error: unknown) {
      return done(error instanceof SelectionMappingMismatchError ? 'selection_mismatch' : 'gmail_error');
    }   // never expose raw errors
    const diagnostics = [...new Set(selection.diagnostics)];
    if (selection.projects.length === 0) return done('no_project', 0, diagnostics);
    // Do not choose between projects on the owner's behalf.
    if (selection.projects.length > 1) return done('ambiguous_multiple_projects', selection.projects.length, diagnostics);
    const sent = await notifier.send(selection.projects[0]!);   // single attempt, no retry
    return done(sent.status === 'sent' ? 'sent' : sent.status === 'telegram_error' ? 'telegram_error'
      : sent.status === 'invalid_project' ? 'invalid_project' : 'destination_unconfirmed', 1, diagnostics);
  } };
}

/**
 * Production loader for the smoke run: the existing reader for exactly one ID. No search/list call.
 * From is an allowlist filter, not proof of authenticity.
 */
export async function loadSmokeProjects([messageId]: [string], env: NodeJS.ProcessEnv,
  trace: SmokeStructureDiagnostics): Promise<ParseResult> {
  try {
    if (!trace.selected_id_matches_candidate_1) throw new SelectionMappingMismatchError();
    const config = loadGmailConfig(env);
    const reader = await createGmailProjectReader(config, ['news@kwork.ru']);
    return await readKworkProjects(reader, [messageId], KWORK_TABLE_POLICY, trace);
  } finally {
    printSmokeStructureDiagnostics(trace);
  }
}
