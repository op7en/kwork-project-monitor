export interface Config {
  telegramBotToken: string;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const telegramBotToken = env['TELEGRAM_BOT_TOKEN']?.trim();

  if (!telegramBotToken) {
    throw new ConfigError(
      'TELEGRAM_BOT_TOKEN отсутствует. Создайте .env из .env.example и укажите токен BotFather.',
    );
  }

  if (telegramBotToken === 'your_telegram_bot_token_here') {
    throw new ConfigError('Замените TELEGRAM_BOT_TOKEN в .env настоящим токеном из BotFather.');
  }

  return { telegramBotToken };
}
