import { ConfigError } from './env.js';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  expectedAccountEmail: string;
}

export function loadGmailConfig(env: NodeJS.ProcessEnv = process.env): GmailConfig {
  const required = (key: string, placeholder: string): string => {
    const value = env[key]?.trim();
    if (!value || value.toLowerCase() === placeholder) {
      throw new ConfigError(`${key} отсутствует или содержит пример. Укажите значение в локальном .env.`);
    }
    return value;
  };

  const clientId = required('GMAIL_CLIENT_ID', 'your_google_client_id');
  const clientSecret = required('GMAIL_CLIENT_SECRET', 'your_google_client_secret');
  const refreshToken = required('GMAIL_REFRESH_TOKEN', 'your_google_refresh_token');
  const expectedAccountEmail = required('GMAIL_EXPECTED_ACCOUNT_EMAIL', 'your_email@example.com')
    .toLowerCase();
  const [local, domain, extra] = expectedAccountEmail.split('@');
  if (!local || !domain || extra !== undefined || local.startsWith('.') || local.endsWith('.') ||
      local.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    throw new ConfigError('GMAIL_EXPECTED_ACCOUNT_EMAIL должен содержать корректный email адрес.');
  }

  return { clientId, clientSecret, refreshToken, expectedAccountEmail };
}
