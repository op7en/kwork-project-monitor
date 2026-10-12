import { afterEach, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { createMonitorController } from '../src/monitor/controller.js';
import type { UserFromGetMe, Update } from 'grammy/types';
import type { PassResult } from '../src/monitor/pass.js';
const owner = 7654321;
const info = { id: 9001, is_bot: true, first_name: 'Synthetic', username: 'test_monitor' } as UserFromGetMe;
const result: PassResult = { status: 'initialized', messages: 0, found: 0, match: 0, review: 0, exclude: 0, sent: 0, unknown: 0, parseFailed: 0 };
const emptyCounts = { messages: 0, sent: 0, reserved: 0, filtered: 0, delivery_unknown: 0, review: 0, exclude: 0 };
afterEach(() => vi.useRealTimers());
function update(text: string, user = owner, group = false): Update {
  return { update_id: 1, message: { message_id: 1, date: 0,
    from: { id: user, is_bot: false, first_name: 'Synthetic' },
    chat: group ? { id: -1000, type: 'group', title: 'Synthetic' } : { id: user, type: 'private', first_name: 'Synthetic' },
    text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } };
}
function setup() {
  vi.useFakeTimers();
  const run = vi.fn(async () => result), legacy = vi.fn();
  let monitor!: ReturnType<typeof createMonitorController>;
  const bot = createBot('test-only-placeholder', owner, legacy, notifier => {
    monitor = createMonitorController(notifier, () => ({ pass: { run }, store: { counts: () => emptyCounts, close: () => {} } }), 1000);
    return monitor;
  });
  bot.botInfo = info; const requests: string[] = [];
  bot.api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage') throw Error('Unexpected offline API call');
    requests.push('text' in payload ? String(payload.text) : '');
    return Promise.resolve({ ok: true, result: { message_id: 2, date: 0, chat: { id: owner, type: 'private', first_name: 'Synthetic' } } }) as ReturnType<typeof previous<typeof method>>;
  });
  return { bot, run, monitor, requests, legacy };
}
it('does no monitor work at startup, /start, /status, /help or disabled /projects', async () => {
  const s = setup();
  for (const command of ['/start', '/monitor status', '/help', '/projects']) await s.bot.handleUpdate(update(command));
  await vi.advanceTimersByTimeAsync(2000);
  expect(s.run).not.toHaveBeenCalled(); expect(s.legacy).not.toHaveBeenCalled();
  expect(s.monitor.status().enabled).toBe(false);
});
it.each([[owner, true], [owner + 1, false]] as const)('cannot enable from foreign/group context %#', async (user, group) => {
  const s = setup();
  for (const command of ['/monitor on', '/monitor off', '/monitor status', '/monitor baseline confirm', '/projects'])
    await s.bot.handleUpdate(update(command, user, group));
  expect(s.monitor.status().enabled).toBe(false); expect(s.requests).toEqual([]); expect(s.run).not.toHaveBeenCalled();
});
it('requires fresh on after restart, shares /projects pass and honors off', async () => {
  const s = setup(); await s.bot.handleUpdate(update('/monitor on'));
  expect(s.monitor.status().enabled).toBe(true); expect(s.run).toHaveBeenCalledTimes(1);
  await s.bot.handleUpdate(update('/projects')); expect(s.run).toHaveBeenCalledTimes(2); expect(s.legacy).not.toHaveBeenCalled();
  await s.bot.handleUpdate(update('/monitor off')); await vi.advanceTimersByTimeAsync(5000); expect(s.run).toHaveBeenCalledTimes(2);
  await s.monitor.shutdown();
  const restarted = setup(); expect(restarted.monitor.status().enabled).toBe(false);
  await restarted.bot.handleUpdate(update('/projects')); expect(restarted.run).not.toHaveBeenCalled();
});
it('returns the start update before the pass settles so sequential polling can reach off', async () => {
  const s = setup(); let finish!: (r: PassResult) => void;
  s.run.mockImplementation(() => new Promise(r => { finish = r; }));
  const starting = s.bot.handleUpdate(update('/monitor on'));
  try {
    await vi.waitFor(() => expect(s.requests).toHaveLength(1));
    await starting;
    const stopping = s.bot.handleUpdate(update('/monitor off'));
    await vi.waitFor(() => expect(s.monitor.status().enabled).toBe(false));
    finish(result); await stopping;
    expect(s.monitor.status().running).toBe(false);
  } finally { if (finish) finish(result); await starting; await s.monitor.shutdown(); }
});
