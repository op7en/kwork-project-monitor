import { Bot } from 'grammy';
import { isOwnerPrivateChat } from '../bot/privateChat.js';
import { createProjectNotifier } from '../bot/projectNotifications.js';
import { createAcceptancePass } from './acceptance.js';
import type { MonitorStore } from './store.js';

type AcceptanceResult = Awaited<ReturnType<ReturnType<typeof createAcceptancePass>['run']>>;
/** No replies, no scheduler: the only outgoing message can be the validated project card. */
export function createAcceptanceBot(token: string, ownerId: number,
  create: (notifier: ReturnType<typeof createProjectNotifier>) => { store: MonitorStore; pass: ReturnType<typeof createAcceptancePass> },
  finished: (result: AcceptanceResult) => void) {
  const bot = new Bot(token, { client: { timeoutSeconds: 45 } });
  const notifier = createProjectNotifier(bot.api, ownerId);
  let attempted = false, stopped = false;
  let active: Promise<AcceptanceResult> | undefined;
  let store: MonitorStore | undefined;
  bot.command('acceptance', async ctx => {
    if (stopped || attempted || !isOwnerPrivateChat(ctx, ownerId) || !notifier.confirmDestination(ctx)) return;
    attempted = true; // Before resource creation and the first await, including initialization failure.
    active = Promise.resolve().then(async (): Promise<AcceptanceResult> => {
      if (stopped) return { status: 'stopped' };
      try {
        const resources = create(notifier); store = resources.store;
        return await resources.pass.run(() => !stopped);
      } catch { return { status: 'acceptance_error' }; }
    });
    finished(await active);
  });
  return { bot, async shutdown() { stopped = true; await active; store?.close(); } };
}
