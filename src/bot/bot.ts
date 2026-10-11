import { Bot } from 'grammy';
import { isOwnerPrivateChat } from './privateChat.js';

export function createBot(token: string, ownerId: number): Bot {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (isOwnerPrivateChat(ctx, ownerId)) await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Привет! Это Kwork Project Monitor — бот для мониторинга подходящих проектов Kwork.\n' +
      'Сейчас доступны базовые команды. Автоматический мониторинг появится в следующих этапах.\n' +
      'Список команд: /help',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Доступные команды:\n' +
      '/start — описание бота\n' +
      '/help — список команд\n' +
      '/ping — проверка связи (pong)',
    );
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  return bot;
}
