import { expect, it, vi } from 'vitest';
import { createBotLifecycle } from '../src/bot/lifecycle.js';
it('remembers shutdown before polling starts and drains monitor without a late activation', async () => {
  let running = false;
  const bot = { isRunning: () => running, stop: vi.fn(async () => { running = false; }) };
  const shutdown = vi.fn(async () => {});
  const lifecycle = createBotLifecycle(bot, { shutdown }, () => {});
  await lifecycle.stop(); running = true;
  expect(lifecycle.ready()).toBe(false); await lifecycle.stop();
  expect(bot.stop).toHaveBeenCalledTimes(1); expect(shutdown).toHaveBeenCalledTimes(1);
});
