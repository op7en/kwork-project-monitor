import type { Bot } from 'grammy';
import type { Chat, Update, UserFromGetMe } from 'grammy/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/config/env.js';
import { loadSmokeConfig } from '../src/config/smoke.js';
import { GMAIL_READONLY_SCOPE } from '../src/gmail/client.js';
import { createProjectNotifier } from '../src/bot/projectNotifications.js';
import { createOneShotSmoke, loadSmokeProjects, type SmokeResult } from '../src/smoke/oneShot.js';
import { createSmokeController } from '../src/smoke/controller.js';
import { createSmokeBot } from '../src/smoke/smokeBot.js';
import type { Diagnostic, KworkProject, ParseResult } from '../src/kwork/model.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';

const google = vi.hoisted(() => ({ getAccessToken: vi.fn(), getTokenInfo: vi.fn(),
  setCredentials: vi.fn(), getProfile: vi.fn(), list: vi.fn(), get: vi.fn(), gmail: vi.fn() }));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {
  setCredentials = google.setCredentials; getAccessToken = google.getAccessToken; getTokenInfo = google.getTokenInfo;
} }, gmail: google.gmail } }));

const SELECTED_ID = 'synthetic-selected-message';
const gmailEnv = { GMAIL_CLIENT_ID: 'synthetic-client', GMAIL_CLIENT_SECRET: 'synthetic-secret',
  GMAIL_REFRESH_TOKEN: 'synthetic-refresh', GMAIL_EXPECTED_ACCOUNT_EMAIL: 'owner@example.com',
  SMOKE_GMAIL_MESSAGE_ID: SELECTED_ID };
const ownerId = 7654321;
const botInfo: UserFromGetMe = { id: 9001, is_bot: true, first_name: 'Synthetic bot', username: 'synthetic_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
  allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
type PrivateOrGroup = Exclude<Chat, { type: 'channel' }>;
function update(text: string, chat: PrivateOrGroup = { id: ownerId, type: 'private', first_name: 'Synthetic' }, userId = ownerId): Update {
  return { update_id: 1, message: { message_id: 1, date: 0, chat, from: { id: userId, is_bot: false, first_name: 'Synthetic' },
    text, entities: [{ type: 'bot_command', offset: 0, length: text.length }] } };
}
function project(id = '9000001'): KworkProject {
  return { projectId: id, title: 'Синтетический проект', url: `https://kwork.ru/new_offer?project=${id}`, sourceGmailMessageId: 'synthetic' };
}
function fakeNotifier(confirmed = true, sendStatus: 'sent' | 'telegram_error' | 'invalid_project' = 'sent') {
  return { hasConfirmedDestination: vi.fn(() => confirmed), send: vi.fn(async () => ({ status: sendStatus })) };
}

describe('loadSmokeConfig', () => {
  it('requires a well-formed, non-placeholder message ID without echoing it', () => {
    expect(loadSmokeConfig({ SMOKE_GMAIL_MESSAGE_ID: ' abc_DEF-123 ' }).messageId).toBe('abc_DEF-123');
    for (const bad of [undefined, '', '  ', 'your_gmail_message_id_here', 'has space', 'a'.repeat(129), 'a/b', 'a,b']) {
      const env = bad === undefined ? {} : { SMOKE_GMAIL_MESSAGE_ID: bad };
      let message = '';
      try { loadSmokeConfig(env); } catch (error) { expect(error).toBeInstanceOf(ConfigError); message = (error as Error).message; }
      expect(message).toContain('SMOKE_GMAIL_MESSAGE_ID');
      if (bad && bad.trim()) expect(message).not.toContain(bad);
    }
  });
});

describe('createOneShotSmoke (application-level limits)', () => {
  it('reads one ID once and attempts exactly one send', async () => {
    const notifier = fakeNotifier(); const read = vi.fn(async (): Promise<ParseResult> => ({ projects: [project()], diagnostics: [] }));
    const result = await createOneShotSmoke(notifier, read, SELECTED_ID).run();
    expect(result).toEqual({ status: 'sent', projects: 1, sent: 1, diagnostics: [] });
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith([SELECTED_ID]);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'bad id', 'a/b', 'x'.repeat(129)])('rejects invalid ID %#without external work', async id => {
    const notifier = fakeNotifier(); const read = vi.fn();
    expect((await createOneShotSmoke(notifier, read, id).run()).status).toBe('invalid_message_id');
    expect(read).not.toHaveBeenCalled(); expect(notifier.send).not.toHaveBeenCalled();
  });
  it('stops before reading when the destination is unconfirmed', async () => {
    const notifier = fakeNotifier(false); const read = vi.fn();
    expect((await createOneShotSmoke(notifier, read, SELECTED_ID).run()).status).toBe('destination_unconfirmed');
    expect(read).not.toHaveBeenCalled(); expect(notifier.send).not.toHaveBeenCalled();
  });
  it.each([
    ['no_project', [], 0], ['ambiguous_multiple_projects', [project('9000001'), project('9000002')], 2],
  ] as const)('%s never sends', async (status, projects, count) => {
    const notifier = fakeNotifier();
    const result = await createOneShotSmoke(notifier, async () => ({ projects: [...projects], diagnostics: ['message_rejected'] }), SELECTED_ID).run();
    expect(result).toMatchObject({ status, projects: count, sent: 0, diagnostics: ['message_rejected'] });
    expect(notifier.send).not.toHaveBeenCalled();
  });
  it('maps reader exceptions to gmail_error without sending or leaking the error', async () => {
    const notifier = fakeNotifier();
    const result = await createOneShotSmoke(notifier, async () => { throw Error('SYNTHETIC_PRIVATE_GMAIL_ERROR'); }, SELECTED_ID).run();
    expect(result).toEqual({ status: 'gmail_error', projects: 0, sent: 0, diagnostics: [] });
    expect(notifier.send).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it.each(['telegram_error', 'invalid_project'] as const)('reports %s after one attempt, no retry', async status => {
    const notifier = fakeNotifier(true, status);
    const result = await createOneShotSmoke(notifier, async () => ({ projects: [project()], diagnostics: [] }), SELECTED_ID).run();
    expect(result).toMatchObject({ status, projects: 1, sent: 0 });
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });
  it('reserves the single attempt synchronously: concurrent and later runs do nothing', async () => {
    const notifier = fakeNotifier(); let release!: () => void;
    const read = vi.fn(() => new Promise<ParseResult>(resolve => { release = () => resolve({ projects: [project()], diagnostics: [] }); }));
    const smoke = createOneShotSmoke(notifier, read, SELECTED_ID);
    const first = smoke.run(); const second = await smoke.run();   // second starts while first is pending
    expect(second.status).toBe('already_used'); expect(read).toHaveBeenCalledTimes(1);
    release(); expect((await first).status).toBe('sent');
    expect((await smoke.run()).status).toBe('already_used');
    expect(read).toHaveBeenCalledTimes(1); expect(notifier.send).toHaveBeenCalledTimes(1);
  });
  it('consumes the attempt even after an early failure (no automatic retry)', async () => {
    const notifier = fakeNotifier(false); const read = vi.fn(async () => ({ projects: [], diagnostics: [] }));
    const smoke = createOneShotSmoke(notifier, read, SELECTED_ID);
    expect((await smoke.run()).status).toBe('destination_unconfirmed');
    notifier.hasConfirmedDestination.mockReturnValue(true);
    expect((await smoke.run()).status).toBe('already_used'); expect(read).not.toHaveBeenCalled();
  });
});

function tableMessage(id: string, rows: string, sender = 'news@kwork.ru', full = true, body?: string) {
  const html = `<table>${TABLE_HEADER}${rows}</table>`;
  return { data: { id, sizeEstimate: 5000, payload: { headers: [
    { name: 'Subject', value: 'Новые проекты на бирже Kwork' }, { name: 'From', value: sender }],
    ...(full ? { mimeType: 'text/html', body: { data: body ?? Buffer.from(html).toString('base64url') } } : {}) } } };
}
const SECOND_ROW = TABLE_ROW.replaceAll('9000001', '9000002');
function intercept(bot: Bot, failProject = false) {
  bot.botInfo = botInfo; const requests: Record<string, unknown>[] = [];
  bot.api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage') throw Error('Unexpected Telegram mock call');
    requests.push(payload);
    if (failProject && 'reply_markup' in payload && payload.reply_markup) return Promise.reject(Error('SYNTHETIC_PRIVATE_TELEGRAM_ERROR'));
    return Promise.resolve({ ok: true, result: { message_id: 2, date: 0, chat: { id: ownerId, type: 'private', first_name: 'S' },
      from: botInfo, text: 'x' } }) as ReturnType<typeof previous<typeof method>>;
  });
  return requests;
}
function makeSmokeBot(opts: { failProject?: boolean; messageId?: string; env?: NodeJS.ProcessEnv } = {}) {
  const onFinished = vi.fn(); const onStarted = vi.fn(() => true);
  const bot = createSmokeBot('test-only-placeholder', ownerId, opts.messageId ?? SELECTED_ID,
    id => loadSmokeProjects(id, opts.env ?? gmailEnv), onFinished, onStarted);
  return { bot, requests: intercept(bot, opts.failProject), onFinished, onStarted };
}
const formats = () => google.get.mock.calls.map(c => c[0].format as string);
const projectMessages = (requests: Record<string, unknown>[]) => requests.filter(r => r['reply_markup']);
const outcome = (onFinished: ReturnType<typeof vi.fn>) => onFinished.mock.calls[0]?.[0] as SmokeResult;

beforeEach(() => {
  vi.resetAllMocks();
  google.getAccessToken.mockResolvedValue({ token: 'synthetic-access' });
  google.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE] });
  google.getProfile.mockResolvedValue({ data: { emailAddress: 'owner@example.com' } });
  google.gmail.mockReturnValue({ users: { getProfile: google.getProfile, messages: { list: google.list, get: google.get } } });
  google.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => tableMessage(id, TABLE_ROW, 'news@kwork.ru', format === 'full'));
});

describe('smoke bot → Google boundary → MIME/table → mock Telegram', () => {
  it('does nothing at construction or for other commands (including /projects)', async () => {
    const { bot, requests } = makeSmokeBot();
    for (const command of ['/start', '/help', '/ping', '/projects']) await bot.handleUpdate(update(command));
    expect(requests).toEqual([]); expect(google.getAccessToken).not.toHaveBeenCalled();
  });
  it.each([
    [{ id: -10001, type: 'group', title: 'Synthetic group' }, ownerId],
    [{ id: -10002, type: 'supergroup', title: 'Synthetic group' }, ownerId],
    [{ id: ownerId + 1, type: 'private', first_name: 'Other' }, ownerId + 1],
    [{ id: ownerId + 1, type: 'private', first_name: 'Other' }, ownerId],
  ] satisfies [PrivateOrGroup, number][])('F3: ignores /smoke outside owner private chat %#', async (chat, userId) => {
    const { bot, requests, onFinished, onStarted } = makeSmokeBot(); await bot.handleUpdate(update('/smoke', chat, userId));
    expect(requests).toEqual([]); expect(google.getAccessToken).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled(); expect(onStarted).not.toHaveBeenCalled();
    await bot.handleUpdate(update('/smoke'));   // a foreign update must not have consumed the attempt
    expect(projectMessages(requests)).toHaveLength(1);
  });
  it('happy path: one metadata + one full read, no list, exactly ONE Telegram message (the card), then finishes', async () => {
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(formats()).toEqual(['metadata', 'full']); expect(google.list).not.toHaveBeenCalled();
    expect(google.get.mock.calls.every(c => c[0].id === SELECTED_ID)).toBe(true);
    expect(requests).toHaveLength(1);   // no status, "started" or "finished" message
    expect(requests[0]).toMatchObject({ chat_id: ownerId,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', url: 'https://kwork.ru/new_offer?project=9000001' }]] } });
    expect(JSON.stringify(requests)).not.toContain(SELECTED_ID);
    expect(onFinished).toHaveBeenCalledTimes(1); expect(outcome(onFinished)).toEqual({ status: 'sent', projects: 1, sent: 1, diagnostics: [] });
  });
  it('a repeated /smoke after completion is silent: no Gmail, no Telegram, no second finish', async () => {
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    await bot.handleUpdate(update('/smoke'));
    expect(formats()).toEqual(['metadata', 'full']); expect(requests).toHaveLength(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
  it('a /smoke during the active run is silent and does not start a second pipeline', async () => {
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    google.getAccessToken.mockImplementation(() => { entered(); return new Promise(resolve => { release = () => resolve({ token: 'synthetic-access' }); }); });
    const { bot, requests, onFinished } = makeSmokeBot();
    const first = bot.handleUpdate(update('/smoke')); await started;
    await bot.handleUpdate(update('/smoke')); await bot.handleUpdate(update('/smoke'));
    expect(google.getAccessToken).toHaveBeenCalledTimes(1); expect(onFinished).not.toHaveBeenCalled(); expect(requests).toEqual([]);
    release(); await first;
    expect(formats()).toEqual(['metadata', 'full']); expect(requests).toHaveLength(1); expect(onFinished).toHaveBeenCalledTimes(1);
  });
  it('simultaneous /smoke updates reserve exactly one attempt', async () => {
    const { bot, requests, onFinished } = makeSmokeBot();
    await Promise.all([bot.handleUpdate(update('/smoke')), bot.handleUpdate(update('/smoke')), bot.handleUpdate(update('/smoke'))]);
    expect(google.getAccessToken).toHaveBeenCalledTimes(1); expect(formats()).toEqual(['metadata', 'full']);
    expect(requests).toHaveLength(1); expect(onFinished).toHaveBeenCalledTimes(1);
  });
  it('rejects unconfirmed sender at metadata: no full read, NO Telegram messages', async () => {
    google.get.mockImplementation(async ({ id }: { id: string }) => tableMessage(id, TABLE_ROW, 'attacker@example.com', false));
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(formats()).toEqual(['metadata']); expect(requests).toEqual([]);
    expect(outcome(onFinished)).toEqual({ status: 'no_project', projects: 0, sent: 0, diagnostics: ['message_rejected'] });
  });
  it('rejects a mismatching message ID returned by Gmail without Telegram messages', async () => {
    google.get.mockImplementation(async ({ format }: { format: string }) => tableMessage('another-message', TABLE_ROW, 'news@kwork.ru', format === 'full'));
    const { bot, requests } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(formats()).toEqual(['metadata']); expect(requests).toEqual([]);
  });
  it.each(['scopes', 'account', 'token'] as const)('Gmail %s failure stops before any message read, silent in Telegram', async stage => {
    if (stage === 'scopes') google.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE, 'https://mail.google.com/'] });
    if (stage === 'account') google.getProfile.mockResolvedValue({ data: { emailAddress: 'other@example.com' } });
    if (stage === 'token') google.getAccessToken.mockRejectedValue(Error('SYNTHETIC_PRIVATE_OAUTH_ERROR'));
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(google.get).not.toHaveBeenCalled(); expect(requests).toEqual([]);
    expect(outcome(onFinished).status).toBe('gmail_error'); expect(JSON.stringify(outcome(onFinished))).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('missing Gmail configuration is a silent gmail_error without authentication', async () => {
    const { bot, requests, onFinished } = makeSmokeBot({ env: { SMOKE_GMAIL_MESSAGE_ID: SELECTED_ID } }); await bot.handleUpdate(update('/smoke'));
    expect(google.getAccessToken).not.toHaveBeenCalled(); expect(requests).toEqual([]); expect(outcome(onFinished).status).toBe('gmail_error');
  });
  it.each([
    ['empty', Buffer.from('').toString('base64url')],
    ['corrupt', '%%%'],
    ['unrecognizable', Buffer.from('<table><tr><td>Broken synthetic layout').toString('base64url')],
  ])('%s body: no_project and no Telegram messages', async (_name, body) => {
    google.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => tableMessage(id, TABLE_ROW, 'news@kwork.ru', format === 'full', body));
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(requests).toEqual([]); expect(outcome(onFinished)).toMatchObject({ status: 'no_project', sent: 0 });
  });
  it('a failed full read is a silent no_project and the body request is not repeated', async () => {
    google.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => {
      if (format === 'full') throw Error('SYNTHETIC_PRIVATE_GMAIL_ERROR'); return tableMessage(id, TABLE_ROW, 'news@kwork.ru', false);
    });
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(formats()).toEqual(['metadata', 'full']); expect(requests).toEqual([]);
    expect(outcome(onFinished).diagnostics).toContain('message_read_failed'); expect(JSON.stringify(outcome(onFinished))).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('multiple valid projects: ambiguous_multiple_projects, nothing is chosen, NO Telegram messages', async () => {
    google.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => tableMessage(id, TABLE_ROW + SECOND_ROW, 'news@kwork.ru', format === 'full'));
    const { bot, requests, onFinished } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(requests).toEqual([]); expect(outcome(onFinished)).toMatchObject({ status: 'ambiguous_multiple_projects', projects: 2, sent: 0 });
  });
  it('an invalid project URL produces no project and no Telegram messages', async () => {
    const bad = TABLE_ROW.replace('?project=9000001', '?project=9000001&utm=1');
    google.get.mockImplementation(async ({ id, format }: { id: string; format: string }) => tableMessage(id, bad, 'news@kwork.ru', format === 'full'));
    const { bot, requests } = makeSmokeBot(); await bot.handleUpdate(update('/smoke'));
    expect(requests).toEqual([]);
  });
  it('Telegram project failure: exactly one attempt, no status message, no leak, finishes', async () => {
    const { bot, requests, onFinished } = makeSmokeBot({ failProject: true }); await bot.handleUpdate(update('/smoke'));
    expect(requests).toHaveLength(1);   // the failed card attempt only; no retry, no error message to the chat
    expect(outcome(onFinished)).toEqual({ status: 'telegram_error', projects: 1, sent: 0, diagnostics: [] });
    expect(JSON.stringify(onFinished.mock.calls)).not.toContain('SYNTHETIC_PRIVATE');
  });
});

describe('smoke lifecycle controller (console only, shutdown)', () => {
  function setup() {
    vi.useFakeTimers();
    const bot = { running: true, stop: vi.fn(async () => { bot.running = false; }), isRunning: () => bot.running };
    const out = { info: vi.fn(), error: vi.fn() }; const setExit = vi.fn();
    return { bot, out, setExit, controller: createSmokeController(bot, 1000, out, setExit) };
  }
  afterEach(() => { vi.useRealTimers(); });
  const result = (status: SmokeResult['status'], diagnostics: Diagnostic[] = []): SmokeResult =>
    ({ status, projects: status === 'sent' ? 1 : 0, sent: status === 'sent' ? 1 : 0, diagnostics });

  it('success: exit code 0, console report, bot stopped once, timeout disarmed', () => {
    const { bot, out, setExit, controller } = setup(); controller.arm();
    controller.finished(result('sent')); controller.finished(result('sent'));
    expect(setExit).toHaveBeenLastCalledWith(0); expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining('sent')); vi.advanceTimersByTime(5000);
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });
  it('failure: exit code 1, fixed codes only in the console, bot stopped', () => {
    const { bot, out, setExit, controller } = setup(); controller.arm(); controller.finished(result('no_project', ['message_rejected']));
    expect(setExit).toHaveBeenLastCalledWith(1); expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(out.info).toHaveBeenCalledWith(expect.stringContaining('message_rejected'));
  });
  it('timeout without a command: stops with code 1', () => {
    const { bot, setExit, controller } = setup(); controller.arm(); vi.advanceTimersByTime(999);
    expect(bot.stop).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(bot.stop).toHaveBeenCalledTimes(1); expect(setExit).toHaveBeenCalledWith(1);
  });
  it('a started run is not cut off by the wait timeout', () => {
    const { bot, controller } = setup(); controller.arm(); controller.started(); vi.advanceTimersByTime(60_000);
    expect(bot.stop).not.toHaveBeenCalled();
  });
  it('signal: stops once with code 1 and cancels the timer', () => {
    const { bot, setExit, controller } = setup(); controller.arm(); controller.interrupt(); controller.interrupt(); vi.advanceTimersByTime(5000);
    expect(bot.stop).toHaveBeenCalledTimes(1); expect(setExit).toHaveBeenLastCalledWith(1);
  });
  it('a failing stop is reported safely and sets a non-zero exit code', async () => {
    const { bot, out, setExit, controller } = setup(); bot.stop.mockRejectedValue(Error('SYNTHETIC_PRIVATE_STOP_ERROR'));
    controller.finished(result('sent')); await vi.advanceTimersByTimeAsync(0);
    expect(setExit).toHaveBeenLastCalledWith(1); expect(JSON.stringify(out.error.mock.calls)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('does not stop a bot that is not running', () => {
    const { bot, controller } = setup(); bot.running = false; controller.interrupt();
    expect(bot.stop).not.toHaveBeenCalled();
  });
  it('a late onStart after interruption leaves no timer or Gmail work (real grammY lifecycle)', async () => {
    vi.useFakeTimers();
    const out = { info: vi.fn(), error: vi.fn() }; const setExit = vi.fn();
    const read = vi.fn(async (): Promise<ParseResult> => ({ projects: [project()], diagnostics: [] }));
    const bot = createSmokeBot('test-only-placeholder', ownerId, SELECTED_ID, read,
      result => controller.finished(result), () => controller.started());
    const controller = createSmokeController(bot, 1000, out, setExit);
    let release!: () => void;
    const methods: string[] = [];
    bot.api.config.use((previous, method) => {
      methods.push(method);
      if (method === 'getMe') return new Promise<{ ok: true; result: UserFromGetMe }>(resolve => {
        release = () => resolve({ ok: true, result: botInfo });
      }) as ReturnType<typeof previous<typeof method>>;
      if (method === 'deleteWebhook') return Promise.resolve({ ok: true, result: true }) as ReturnType<typeof previous<typeof method>>;
      if (method === 'getUpdates') return Promise.resolve({ ok: true, result: [] }) as ReturnType<typeof previous<typeof method>>;
      throw Error('Unexpected Telegram mock call');
    });
    const startup = bot.start({ drop_pending_updates: true, onStart: () => { controller.arm(); } });
    expect(bot.isRunning()).toBe(true); // 1.46 sets this before asynchronous initialization
    controller.interrupt(); release(); await startup;
    expect(bot.isRunning()).toBe(false);
    expect(methods.filter(method => method === 'getUpdates')).toHaveLength(1); // stop acknowledgement only
    expect(vi.getTimerCount()).toBe(0);
    await bot.handleUpdate(update('/smoke')); // even a late dispatch must remain inert
    expect(read).not.toHaveBeenCalled();
    expect(setExit).toHaveBeenLastCalledWith(1);
  });
  it('completion after interruption cannot overwrite the exit code or finish twice', () => {
    const { bot, out, setExit, controller } = setup(); controller.arm(); controller.interrupt();
    controller.finished(result('sent')); controller.finished(result('sent'));
    expect(setExit).toHaveBeenLastCalledWith(1);
    expect(out.info).not.toHaveBeenCalled(); expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('notifier is the existing component (destination is never taken from input)', () => {
  it('uses the real notifier: unconfirmed instance cannot send', async () => {
    const send = vi.fn(); const notifier = createProjectNotifier({ sendMessage: send } as never, ownerId);
    const read = vi.fn();
    expect((await createOneShotSmoke(notifier, read, SELECTED_ID).run()).status).toBe('destination_unconfirmed');
    expect(read).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
});
