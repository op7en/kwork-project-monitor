import { createBot } from './bot/bot.js';
import { ConfigError, loadConfig } from './config/env.js';
import { loadNotificationProjects } from './gmail/notificationProjects.js';

try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  const bot = createBot(telegramBotToken, telegramOwnerId, () => loadNotificationProjects());

  // HTTP errors can contain the Bot API URL with its token. Never log raw errors.
  bot.catch(({ ctx }) => {
    console.error(`Ошибка обработки Telegram update ${ctx.update.update_id}.`);
  });

  const stop = () => {
    if (bot.isRunning()) {
      void bot.stop().catch(() => {
        console.error('Не удалось корректно остановить Telegram-бота.');
        process.exitCode = 1;
      });
    }
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  await bot.start({
    onStart: () => { console.info('Kwork Project Monitor запущен.'); },
  });
} catch (error: unknown) {
  // Only our own configuration errors have messages safe to print.
  console.error(error instanceof ConfigError
    ? error.message
    : 'Не удалось запустить Telegram-бота. Проверьте токен, сеть и отсутствие второго экземпляра.');
  process.exitCode = 1;
}
