export interface Config {
  telegramBotToken: string;
  telegramOwnerId: number;
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

  const rawOwnerId = env['TELEGRAM_OWNER_ID']?.trim();

  if (!rawOwnerId) {
    throw new ConfigError('TELEGRAM_OWNER_ID отсутствует. Укажите числовой Telegram user ID владельца в .env.');
  }

  if (!/^[1-9]\d*$/.test(rawOwnerId)) {
    throw new ConfigError('TELEGRAM_OWNER_ID должен быть положительным целым числом.');
  }

  const telegramOwnerId = Number(rawOwnerId);
  if (!Number.isSafeInteger(telegramOwnerId)) {
    throw new ConfigError('TELEGRAM_OWNER_ID выходит за безопасный диапазон целых чисел.');
  }

  return { telegramBotToken, telegramOwnerId };
}
