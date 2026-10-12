import { afterEach, expect, it, vi } from 'vitest';
import { createSmokeBot } from '../src/smoke/smokeBot.js';

vi.mock('../src/config/env.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/config/env.js')>(),
  loadConfig: () => ({ telegramBotToken: 'test-only-placeholder', telegramOwnerId: 7654321 }),
}));
vi.mock('../src/config/smoke.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/config/smoke.js')>(),
  loadSmokeConfig: () => ({ messageId: 'synthetic-selected-message' }),
}));
vi.mock('../src/smoke/smokeBot.js', () => ({ createSmokeBot: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('polling failure after readiness cancels the wait timer and reports only a fixed error', async () => {
  vi.useFakeTimers();
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const previousExitCode = process.exitCode;
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const previousListeners = signals.map(signal => process.listeners(signal));
  let running = false;
  const stop = vi.fn(async () => { running = false; });
  // Model grammY's documented rejection after onStart, with pollingRunning cleared.
  const bot = { stop, isRunning: () => running, catch: vi.fn(),
    start: vi.fn(async (options: { onStart: () => void; drop_pending_updates: boolean }) => {
      expect(options.drop_pending_updates).toBe(true);
      running = true; options.onStart(); running = false;
      throw Error('SYNTHETIC_PRIVATE_POLLING_ERROR');
    }),
  };
  vi.mocked(createSmokeBot).mockReturnValue(bot as unknown as ReturnType<typeof createSmokeBot>);
  try {
    await import('../src/smoke/run.js'); // config and bot boundaries are mocked; no API calls
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Не удалось запустить smoke-бота.');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SYNTHETIC_PRIVATE');
    expect(process.exitCode).toBe(1);
    expect(stop).not.toHaveBeenCalled(); // grammY already stopped polling on failure
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(info).toHaveBeenCalledTimes(1); // no misleading timeout after failure
  } finally {
    process.exitCode = previousExitCode;
    signals.forEach((signal, index) => {
      for (const listener of process.listeners(signal)) {
        if (!previousListeners[index]!.includes(listener)) process.removeListener(signal, listener);
      }
    });
  }
});
