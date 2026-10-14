import { createBot } from './bot/bot.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createMonitorRuntime } from './monitor/runtime.js';
import type { MonitorController } from './monitor/controller.js';
import { createBotLifecycle } from './bot/lifecycle.js';
import { safeErrorDetails } from './gmail/client.js';

try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  let monitor: MonitorController | undefined;
  const bot = createBot(telegramBotToken, telegramOwnerId, undefined, notifier => {
    monitor = createMonitorRuntime(notifier, telegramOwnerId);
    return monitor;
  });

  // HTTP errors can contain the Bot API URL with its token. Never log raw errors.
  bot.catch(error => {
    console.error(JSON.stringify({ event: 'telegram_update_error', ...safeErrorDetails(error.error, 'telegram_update') }));
  });

  const lifecycle = createBotLifecycle(bot, monitor, (error?: unknown) => {
    console.error(JSON.stringify({ event: 'shutdown_error', ...safeErrorDetails(error, 'shutdown') })); process.exitCode = 1;
  });
  const stop = () => { void lifecycle.stop(); };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: () => {
        if (!lifecycle.ready()) return;
        console.info(JSON.stringify({ event: 'bot_ready' }));
        void monitor?.restore().catch(error => {
          console.error(JSON.stringify({ event: 'monitor_restore_error', ...safeErrorDetails(error, 'monitor_restore') }));
        });
      },
    });
  } finally {
    await lifecycle.stop();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
} catch (error: unknown) {
  // Only our own configuration errors have messages safe to print.
  console.error(error instanceof ConfigError
    ? error.message
    : JSON.stringify({ event: 'bot_start_error', ...safeErrorDetails(error, 'telegram_start') }));
  process.exitCode = 1;
}
