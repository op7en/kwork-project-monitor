import { ConfigError, loadConfig } from '../config/env.js';
import { loadSmokeConfig } from '../config/smoke.js';
import { createSmokeBot } from './smokeBot.js';
import { createSmokeController } from './controller.js';
import { loadSmokeProjects } from './oneShot.js';

// Manual one-shot entry point. Do NOT run together with the production bot: both use the same
// Telegram token and long polling would conflict. Starting this file is a live operation.
const WAIT_LIMIT_MS = 10 * 60 * 1000;

try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  const { messageId } = loadSmokeConfig();
  // Handler callbacks run only after construction and controller binding, when polling starts.
  const bot = createSmokeBot(telegramBotToken, telegramOwnerId, messageId, ids => loadSmokeProjects(ids),
    result => controller.finished(result), () => controller.started());
  const controller = createSmokeController(bot, WAIT_LIMIT_MS, console, code => { process.exitCode = code; });
  bot.catch(() => { console.error('Ошибка обработки Telegram update smoke-ботом.'); });
  process.once('SIGINT', () => controller.interrupt());
  process.once('SIGTERM', () => controller.interrupt());

  // Pending updates are dropped so an old /smoke cannot trigger the run; send /smoke after this message.
  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: () => {
        if (!controller.arm()) return;
        console.info('Smoke-бот запущен. Отправьте /smoke в личном чате с ботом.');
      },
    });
  } catch (error: unknown) {
    controller.interrupt(); // startup/polling failures must also cancel the wait timer
    throw error;
  }
} catch (error: unknown) {
  console.error(error instanceof ConfigError ? error.message : 'Не удалось запустить smoke-бота.');
  process.exitCode = 1;
}
