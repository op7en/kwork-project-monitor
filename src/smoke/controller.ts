import type { SmokeResult } from './oneShot.js';

interface Stoppable { stop(): Promise<void>; isRunning(): boolean }
interface Output { info(message: string): void; error(message: string): void }

/**
 * Lifecycle of the temporary bot: console-only reporting, exit code, shutdown after the single attempt,
 * and a wait timeout. Nothing here talks to Telegram or Gmail. Fixed statuses and counters only.
 */
export function createSmokeController(bot: Stoppable, waitLimitMs: number, out: Output, setExitCode: (code: number) => void) {
  let timer: NodeJS.Timeout | undefined;
  let stopRequested = false;
  let stopping = false;
  const halt = (): void => {
    stopRequested = true;
    clearTimeout(timer);
    if (stopping || !bot.isRunning()) return;
    stopping = true;
    // Never await inside a handler: stopping polling from within it would deadlock.
    void bot.stop().catch(() => { out.error('Не удалось корректно остановить smoke-бота.'); setExitCode(1); });
  };
  return {
    /** Arm the wait timeout once polling has started. No command in time → stop, Gmail is never touched. */
    arm(): boolean {
      // grammY can still invoke onStart after stop() during asynchronous setup.
      if (stopRequested) { halt(); return false; }
      timer = setTimeout(() => { out.info('Smoke не получил команду за отведённое время; остановка.'); setExitCode(1); halt(); }, waitLimitMs);
      return true;
    },
    /** The first /smoke began: a long Gmail call must not be cut off by the wait timeout. */
    started(): boolean { clearTimeout(timer); return !stopRequested; },
    finished(result: SmokeResult): void {
      if (stopRequested) return;
      setExitCode(result.status === 'sent' ? 0 : 1);
      out.info(`Smoke завершён: ${result.status}; проектов в письме: ${result.projects}; отправлено: ${result.sent}` +
        (result.diagnostics.length ? `; диагностика: ${result.diagnostics.join(', ')}` : ''));
      halt();
    },
    /** SIGINT/SIGTERM. */
    interrupt(): void { setExitCode(1); halt(); },
  };
}
