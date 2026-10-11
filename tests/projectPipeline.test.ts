import { Api } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { createProjectNotifier } from '../src/bot/projectNotifications.js';
import { createProjectPipeline } from '../src/bot/projectPipeline.js';
import type { KworkProject, ParseResult } from '../src/kwork/model.js';

const ownerId = 7654321;
const context = { from: { id: ownerId, is_bot: false, first_name: 'Synthetic' },
  chat: { id: ownerId, type: 'private' as const, first_name: 'Synthetic' } };
const project: KworkProject = { projectId: '9000001', title: 'Synthetic project',
  url: 'https://kwork.ru/new_offer?project=9000001', sourceGmailMessageId: 'synthetic-message' };
function sender(fail = false) {
  const api = new Api('test-only-placeholder');
  const requests: unknown[] = [];
  api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage') throw new Error('Unexpected API method');
    requests.push(payload);
    if (fail) return Promise.reject(new Error('SYNTHETIC_PRIVATE_ERROR'));
    return Promise.resolve({ ok: true, result: { message_id: 1, date: 0,
      chat: { id: ownerId, type: 'private', first_name: 'Synthetic' }, text: 'Synthetic response' } }) as ReturnType<typeof previous<typeof method>>;
  });
  return { notifier: createProjectNotifier(api, ownerId), requests };
}

describe('Manual project pipeline', () => {
  it('does not read Gmail without confirmation, including after a fresh sender is created', async () => {
    const load = vi.fn<() => Promise<ParseResult>>();
    const first = sender(); first.notifier.confirmDestination(context);
    const fresh = sender();
    const result = await createProjectPipeline(fresh.notifier, load).run();
    expect(result.status).toBe('destination_unconfirmed');
    expect(load).not.toHaveBeenCalled(); expect(fresh.requests).toEqual([]);
  });

  it('attempts each ID once, even if the first send fails, and starts a new dedup set on the next run', async () => {
    const { notifier, requests } = sender(true); notifier.confirmDestination(context);
    const pipeline = createProjectPipeline(notifier, async () => ({ projects: [project, { ...project, title: 'Duplicate' }], diagnostics: [] }));
    expect(await pipeline.run()).toEqual({ status: 'completed', found: 1, sent: 0, failed: 1, skipped: 1, diagnostics: ['duplicate_project'] });
    expect(requests).toHaveLength(1);
    await pipeline.run(); expect(requests).toHaveLength(2);
  });

  it('returns only safe state on loader failure and releases the lock for a later run', async () => {
    const { notifier, requests } = sender(); notifier.confirmDestination(context);
    const load = vi.fn<() => Promise<ParseResult>>().mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_ERROR'))
      .mockResolvedValueOnce({ projects: [], diagnostics: [] });
    const pipeline = createProjectPipeline(notifier, load);
    expect(await pipeline.run()).toEqual({ status: 'gmail_error', found: 0, sent: 0, failed: 0, skipped: 0, diagnostics: [] });
    expect((await pipeline.run()).status).toBe('completed'); expect(requests).toEqual([]);
  });

  it('handles an empty selection and parse diagnostics without Telegram requests', async () => {
    const { notifier, requests } = sender(); notifier.confirmDestination(context);
    const pipeline = createProjectPipeline(notifier, async () => ({ projects: [], diagnostics: ['invalid_base64url'] }));
    expect(await pipeline.run()).toEqual({ status: 'completed', found: 0, sent: 0, failed: 0, skipped: 0, diagnostics: ['invalid_base64url'] });
    expect(requests).toEqual([]);
  });

  it('rejects overlap without reading a second selection or sending twice', async () => {
    const { notifier, requests } = sender(); notifier.confirmDestination(context);
    let release!: (result: ParseResult) => void;
    const load = vi.fn(() => new Promise<ParseResult>(resolve => { release = resolve; }));
    const pipeline = createProjectPipeline(notifier, load);
    const first = pipeline.run();
    expect((await pipeline.run()).status).toBe('busy'); expect(load).toHaveBeenCalledTimes(1);
    release({ projects: [project], diagnostics: [] });
    expect((await first).sent).toBe(1); expect(requests).toHaveLength(1);
  });

  it('skips unsafe projects and continues with valid projects without exposing provenance', async () => {
    const { notifier, requests } = sender(); notifier.confirmDestination(context);
    const pipeline = createProjectPipeline(notifier, async () => ({ projects: [
      { ...project, projectId: '9000002', url: 'https://evil.invalid/new_offer?project=9000002' }, project,
    ], diagnostics: [] }));
    expect(await pipeline.run()).toEqual({ status: 'completed', found: 2, sent: 1, failed: 0, skipped: 1, diagnostics: [] });
    expect(JSON.stringify(requests)).not.toContain('synthetic-message');
    expect(requests[0]).toMatchObject({ chat_id: ownerId, text: 'Новый проект Kwork\nНазвание: Synthetic project',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', url: project.url }]] } });
  });
});
