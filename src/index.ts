import { createBot } from './bot/bot.js';
import { ConfigError, loadConfig } from './config/env.js';
import { createMonitorRuntime } from './monitor/runtime.js';
import type { MonitorController } from './monitor/controller.js';
import { createBotLifecycle } from './bot/lifecycle.js';

try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  let monitor: MonitorController | undefined;
  const bot = createBot(telegramBotToken, telegramOwnerId, undefined, notifier => {
    monitor = createMonitorRuntime(notifier, telegramOwnerId);
    return monitor;
  });

  // HTTP errors can contain the Bot API URL with its token. Never log raw errors.
  bot.catch(() => {
    console.error('telegram_update_error');
  });

  const lifecycle = createBotLifecycle(bot, monitor, () => {
    console.error('shutdown_error'); process.exitCode = 1;
  });
  const stop = () => { void lifecycle.stop(); };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: () => { if (lifecycle.ready()) console.info('Kwork Project Monitor запущен; мониторинг выключен.'); },
    });
  } finally {
    await lifecycle.stop();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
} catch (error: unknown) {
  // Only our own configuration errors have messages safe to print.
  console.error(error instanceof ConfigError
    ? error.message
    : 'Не удалось запустить Telegram-бота. Проверьте токен, сеть и отсутствие второго экземпляра.');
  process.exitCode = 1;
}
