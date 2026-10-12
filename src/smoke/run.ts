import { loadConfig } from '../config/env.js';
import { loadSmokeConfig } from '../config/smoke.js';
import { createSmokeBot } from './smokeBot.js';
import { createSmokeController } from './controller.js';
import { loadSmokeProjects } from './oneShot.js';
import { readSelectedIdMatchesCandidateOne } from './selectionDiagnostics.js';
import { createSmokeStructureDiagnostics } from './structureDiagnostics.js';
import {
  classifySmokeStartupError,
  formatSmokeTelegramApiDiagnostic,
  type SmokeStartupStage,
} from './startupError.js';

// Manual one-shot entry point. Do NOT run together with the production bot: both use the same
// Telegram token and long polling would conflict. Starting this file is a live operation.
const WAIT_LIMIT_MS = 10 * 60 * 1000;

let stage: SmokeStartupStage = 'configuration';
try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  const { messageId } = loadSmokeConfig();
  const structureDiagnostics = createSmokeStructureDiagnostics(readSelectedIdMatchesCandidateOne(messageId));
  // Handler callbacks run only after construction and controller binding, when polling starts.
  stage = 'bot_construction';
  const bot = createSmokeBot(telegramBotToken, telegramOwnerId, messageId,
    ids => loadSmokeProjects(ids, process.env, structureDiagnostics),
    result => controller.finished(result), () => controller.started());
  const controller = createSmokeController(bot, WAIT_LIMIT_MS, console, code => { process.exitCode = code; });
  const reportedApiFailures = new Set<string>();
  bot.api.config.use(async (previous, method, payload, signal) => {
    const report = (error: unknown): void => {
      const diagnostic = formatSmokeTelegramApiDiagnostic(method, error);
      if (diagnostic && !reportedApiFailures.has(method)) {
        reportedApiFailures.add(method);
        console.error(diagnostic);
      }
    };
    try {
      const response = await previous(method, payload, signal);
      if (!response.ok) report(response);
      return response;
    } catch (error: unknown) {
      report(error);
      throw error;
    }
  });
  bot.catch(() => { console.error('Ошибка обработки Telegram update smoke-ботом.'); });
  process.once('SIGINT', () => controller.interrupt());
  process.once('SIGTERM', () => controller.interrupt());

  // Pending updates are dropped so an old /smoke cannot trigger the run; send /smoke after this message.
  stage = 'telegram_startup';
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
  const diagnostic = classifySmokeStartupError(error, stage);
  console.error(`Smoke startup failed: stage=${diagnostic.stage}; category=${diagnostic.category}` +
    (diagnostic.apiErrorCode === undefined ? '' : `; api_error_code=${diagnostic.apiErrorCode}`) +
    (diagnostic.httpStatus === undefined ? '' : `; http_status=${diagnostic.httpStatus}`));
  process.exitCode = 1;
}
