import { Bot } from 'grammy';
import { isOwnerPrivateChat } from './privateChat.js';
import { createProjectNotifier } from './projectNotifications.js';
import { createProjectPipeline } from './projectPipeline.js';
import type { ParseResult } from '../kwork/model.js';
import type { MonitorController } from '../monitor/controller.js';
import { safeErrorDetails } from '../gmail/client.js';

export function createBot(token: string, ownerId: number, loadProjects?: () => Promise<ParseResult>,
  monitorFactory?: (notifier: ReturnType<typeof createProjectNotifier>) => MonitorController): Bot {
  const bot = new Bot(token, { client: { timeoutSeconds: 45 } });
  const notifier = createProjectNotifier(bot.api, ownerId);
  const monitor = monitorFactory?.(notifier);
  const pipeline = !monitor && loadProjects ? createProjectPipeline(notifier, loadProjects) : undefined;
  const background = (operation: Promise<unknown>): void => {
    // Long polling awaits handlers sequentially. Release the update so /monitor off can cancel a pass.
    void operation.catch(error => { console.error(JSON.stringify({ event: 'monitor_control_error', ...safeErrorDetails(error, 'monitor_command') })); });
  };

  bot.use(async (ctx, next) => {
    if (isOwnerPrivateChat(ctx, ownerId)) await next();
  });

  bot.command('start', async (ctx) => {
    notifier.confirmDestination(ctx);
    await ctx.reply(
      'Привет! Это Kwork Project Monitor — бот для мониторинга подходящих проектов Kwork.\n' +
      (monitor ? 'Мониторинг включается через /monitor on в этом личном чате и восстанавливается после рестарта. Состояние — /monitor status.\n' :
        'Сейчас доступны базовые команды. Автоматический мониторинг появится в следующих этапах.\n') +
      'Список команд: /help',
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Доступные команды:\n' +
      '/start — описание бота\n' +
      '/help — список команд\n' +
      '/ping — проверка связи (pong)\n' +
      (monitor ? '/projects — один проход активированного мониторинга с фильтрацией и постоянной дедупликацией\n' +
        '/monitor on | off | status — управление мониторингом\n' +
        '/monitor baseline — первоначальный baseline; baseline confirm — явно пропустить backlog при OFF' :
        '/projects — один ручной проход Gmail (без фильтрации; повторный вызов может повторить проекты)'),
    );
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command('projects', async (ctx) => {
    if (monitor) {
      if (!notifier.confirmDestination(ctx)) return;
      background(monitor.run());
      await ctx.reply('Monitor: ' + JSON.stringify(monitor.status()));
      return;
    }
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

  bot.command('monitor', async ctx => {
    if (!monitor) { await ctx.reply('Мониторинг не подключён.'); return; }
    const command = ctx.match.trim();
    if (command === 'on' || command === 'baseline' || command === 'baseline confirm') {
      if (!notifier.confirmDestination(ctx)) return;
      background(command === 'on' ? monitor.on() : monitor.baseline(command === 'baseline confirm'));
      await ctx.reply('Monitor: ' + JSON.stringify(monitor.status()));
    } else if (command === 'off') {
      await monitor.off(); await ctx.reply('Monitor: ' + JSON.stringify(monitor.status()));
    } else if (command === 'status') {
      await ctx.reply('Monitor: ' + JSON.stringify(monitor.status()));
    } else { await ctx.reply('/monitor on | off | status | baseline | baseline confirm (пропустить backlog при OFF)'); }
  });
  return bot;
}
