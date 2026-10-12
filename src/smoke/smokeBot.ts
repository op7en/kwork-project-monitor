import { Bot } from 'grammy';
import { isOwnerPrivateChat } from '../bot/privateChat.js';
import { createProjectNotifier } from '../bot/projectNotifications.js';
import type { ParseResult } from '../kwork/model.js';
import { createOneShotSmoke, type SmokeResult } from './oneShot.js';

/**
 * Temporary bot for the one-shot smoke. Only /smoke exists; it uses the same owner/private/chat ID guard (F3)
 * and a real Telegram context to confirm the destination. `onFinished` is called once after the single attempt.
 * The only outgoing Telegram message of a whole run is the project card sent by the notifier: this bot never
 * replies to /smoke, so errors, empty or ambiguous results produce no Telegram traffic at all.
 * `onFinished` must not be awaited by this handler: stopping polling from inside a handler would deadlock.
 */
export function createSmokeBot(token: string, ownerId: number, messageId: string,
  loadProjects: (ids: [string]) => Promise<ParseResult>, onFinished: (result: SmokeResult) => void,
  onStarted: () => boolean = () => true): Bot {
  const bot = new Bot(token);
  const notifier = createProjectNotifier(bot.api, ownerId);
  const smoke = createOneShotSmoke(notifier, loadProjects, messageId);

  bot.use(async (ctx, next) => { if (isOwnerPrivateChat(ctx, ownerId)) await next(); });

  bot.command('smoke', async (ctx) => {
    if (!onStarted()) return; // shutdown forbids a new attempt, including a late startup/update
    if (!notifier.confirmDestination(ctx)) return;
    let result: SmokeResult;
    try {
      // run() reserves the only attempt synchronously, before any asynchronous work.
      result = await smoke.run();
    } catch {
      result = { status: 'internal_error', projects: 0, sent: 0, diagnostics: [] };   // never leave the bot waiting
    }
    if (result.status === 'already_used') return;   // the first call owns the report and shutdown
    onFinished(result);
  });

  return bot;
}

