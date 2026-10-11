import { Bot } from 'grammy';
import { isOwnerPrivateChat } from './privateChat.js';
import { createProjectNotifier } from './projectNotifications.js';
import { createProjectPipeline } from './projectPipeline.js';
import type { ParseResult } from '../kwork/model.js';

export function createBot(token: string, ownerId: number, loadProjects?: () => Promise<ParseResult>): Bot {
  const bot = new Bot(token);
  const notifier = createProjectNotifier(bot.api, ownerId);
  const pipeline = loadProjects ? createProjectPipeline(notifier, loadProjects) : undefined;

  bot.use(async (ctx, next) => {
    if (isOwnerPrivateChat(ctx, ownerId)) await next();
  });

  bot.command('start', async (ctx) => {
    notifier.confirmDestination(ctx);
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
      '/ping — проверка связи (pong)\n' +
      '/projects — один ручной проход Gmail (без фильтрации; повторный вызов может повторить проекты)',
    );
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command('projects', async (ctx) => {
    if (!pipeline) { await ctx.reply('Ручной pipeline не подключён.'); return; }
    if (!notifier.confirmDestination(ctx)) return;
    const result = await pipeline.run();
    if (result.status === 'busy') { await ctx.reply('Предыдущий проход ещё выполняется.'); return; }
    if (result.status === 'gmail_error') {
      await ctx.reply('Не удалось выполнить Gmail проход. Проверьте конфигурацию, доступ и сеть.');
      return;
    }
    if (result.status === 'destination_unconfirmed') {
      await ctx.reply('Личный чат владельца не подтверждён.'); return;
    }
    // Counts and fixed diagnostic codes only: never mail IDs, body or raw API errors.
    await ctx.reply(`Проход завершён. Фильтрация по стеку не выполнялась.\nИзвлечено: ${result.found}\n` +
      `Отправлено: ${result.sent}\nОшибки отправки: ${result.failed}\nПропущено: ${result.skipped}` +
      (result.diagnostics.length ? `\nДиагностика: ${result.diagnostics.join(', ')}` : ''));
  });

  return bot;
}
