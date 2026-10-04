import { Bot } from 'grammy';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

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
