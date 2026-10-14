import { beforeEach, expect, it, vi } from 'vitest';
const app = vi.hoisted(() => ({ ready: true, restore: vi.fn(), stop: vi.fn() }));
vi.mock('../src/config/env.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...original, loadConfig: () => ({ telegramBotToken: 'test-only-placeholder', telegramOwnerId: 123 }) };
});
vi.mock('../src/monitor/runtime.js', () => ({ createMonitorRuntime: () => ({ restore: app.restore }) }));
vi.mock('../src/bot/lifecycle.js', () => ({ createBotLifecycle: () => ({ ready: () => app.ready, stop: app.stop }) }));
vi.mock('../src/bot/bot.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/bot/bot.js')>();
  return { createBot: (...args: Parameters<typeof original.createBot>) => {
    const bot = original.createBot(...args);
    // Bot construction is inert; intercept startup before any Telegram transport is used.
    vi.spyOn(bot, 'start').mockImplementation(async options => {
      await options?.onStart?.({ id: 9001, is_bot: true, first_name: 'Synthetic', username: 'synthetic_bot',
        can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
        can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
        allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false });
    });
    return bot;
  } };
});
beforeEach(() => {
  vi.resetModules(); app.ready = true;
  app.restore.mockReset().mockResolvedValue({ status: 'disabled' }); app.stop.mockReset().mockResolvedValue(undefined);
});
it('invokes persisted monitoring restore from the production onStart callback', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try { await import('../src/index.js'); expect(app.restore).toHaveBeenCalledOnce(); }
  finally { log.mockRestore(); }
});
it('does not restore after lifecycle shutdown was requested before onStart', async () => {
  app.ready = false; await import('../src/index.js'); expect(app.restore).not.toHaveBeenCalled();
});
it('contains startup restoration errors in safe structured diagnostics', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  app.restore.mockRejectedValue(Object.assign(new Error('SYNTHETIC_SECRET_TOKEN'), { code: 'EACCES' }));
  try {
    await import('../src/index.js');
    const output = errors.mock.calls.flat().join('');
    expect(output).toContain('monitor_restore_error'); expect(output).toContain('EACCES');
    expect(output).not.toContain('SYNTHETIC_SECRET_TOKEN');
  } finally { log.mockRestore(); errors.mockRestore(); }
});
