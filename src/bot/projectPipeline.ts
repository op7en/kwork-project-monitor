import type { ParseResult } from '../kwork/model.js';
import type { createProjectNotifier } from './projectNotifications.js';

export interface PipelineResult {
  status: 'completed' | 'gmail_error' | 'busy' | 'destination_unconfirmed';
  found: number;
  sent: number;
  failed: number;
  skipped: number;
  diagnostics: ParseResult['diagnostics'];
}

export function createProjectPipeline(notifier: ReturnType<typeof createProjectNotifier>,
  loadProjects: () => Promise<ParseResult>) {
  let running = false;
  return { async run(): Promise<PipelineResult> {
    const result: PipelineResult = { status: 'completed', found: 0, sent: 0, failed: 0, skipped: 0, diagnostics: [] };
    if (!notifier.hasConfirmedDestination()) return { ...result, status: 'destination_unconfirmed' };
    if (running) return { ...result, status: 'busy' };
    running = true;
    try {
      let selection: ParseResult;
      try { selection = await loadProjects(); }
      catch { return { ...result, status: 'gmail_error' }; }
      result.diagnostics = [...selection.diagnostics];
      const seen = new Set<string>();
      for (const project of selection.projects) {
        if (seen.has(project.projectId)) {
          result.skipped++;
          result.diagnostics.push('duplicate_project');
          continue;
        }
        // Mark before the request: an ambiguous Telegram failure must not trigger a retry.
        seen.add(project.projectId);
        result.found++;
        const sent = await notifier.send(project);
        if (sent.status === 'sent') result.sent++;
        else if (sent.status === 'telegram_error') result.failed++;
        else result.skipped++;
      }
      result.diagnostics = [...new Set(result.diagnostics)];
      return result;
    } finally { running = false; }
  } };
}
