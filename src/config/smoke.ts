import { ConfigError } from './env.js';

export interface SmokeConfig { messageId: string }

/** Same shape the Gmail reader accepts, so a value that passes here is never rejected later. */
export const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** One pre-selected Gmail message ID from the local environment. Error text never contains the value. */
export function loadSmokeConfig(env: NodeJS.ProcessEnv = process.env): SmokeConfig {
  const messageId = env['SMOKE_GMAIL_MESSAGE_ID']?.trim();
  if (!messageId || messageId.toLowerCase() === 'your_gmail_message_id_here') {
    throw new ConfigError('SMOKE_GMAIL_MESSAGE_ID отсутствует или не заменён. Укажите ID выбранного письма в локальном окружении.');
  }
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    throw new ConfigError('SMOKE_GMAIL_MESSAGE_ID имеет недопустимый формат (разрешены A-Z, a-z, 0-9, _ и -, до 128 символов).');
  }
  return { messageId };
}
