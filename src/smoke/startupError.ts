import { GrammyError, HttpError } from 'grammy';

export type SmokeStartupStage = 'configuration' | 'bot_construction' | 'telegram_startup' |
  'telegram_get_me' | 'telegram_delete_webhook' | 'telegram_get_updates';
export type SmokeStartupCategory =
  | 'telegram_auth_error'
  | 'telegram_conflict'
  | 'network_error'
  | 'timeout'
  | 'initialization_error';

export interface SmokeStartupDiagnostic {
  stage: SmokeStartupStage;
  category: SmokeStartupCategory;
  httpStatus?: number;
  apiErrorCode?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function statusCode(value: unknown): number | undefined {
  const fields = record(value);
  const candidate = fields?.['status'] ?? fields?.['statusCode'];
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599
    ? candidate
    : undefined;
}

function apiErrorCode(value: unknown): number | undefined {
  const candidate = record(value)?.['error_code'];
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599
    ? candidate
    : undefined;
}

function networkCode(value: unknown): string | undefined {
  const current = record(value);
  const cause = record(current?.['cause']);
  const code = current?.['code'] ?? cause?.['code'];
  return typeof code === 'string' ? code : undefined;
}

export function classifySmokeStartupError(
  error: unknown,
  stage: SmokeStartupStage = 'telegram_startup',
): SmokeStartupDiagnostic {
  const wrapped = error instanceof HttpError ? error.error : error;
  const apiCode = error instanceof GrammyError ? error.error_code : apiErrorCode(wrapped);
  const httpStatus = error instanceof GrammyError
    ? undefined
    : statusCode(wrapped) ?? statusCode(record(wrapped)?.['response']);
  const status = apiCode ?? httpStatus;

  let category: SmokeStartupCategory = 'initialization_error';
  if (status === 401 || status === 403) category = 'telegram_auth_error';
  else if (status === 409) category = 'telegram_conflict';
  else if (status === 408) category = 'timeout';
  else {
    const name = record(wrapped)?.['name'];
    const message = record(wrapped)?.['message'];
    const code = networkCode(wrapped);
    const grammYTimeout = typeof message === 'string' &&
      /^Request to '(?:getMe|deleteWebhook|getUpdates)' timed out after \d+ seconds$/.test(message);
    if (name === 'TimeoutError' || grammYTimeout || [
      'ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT',
    ].includes(code ?? '')) {
      category = 'timeout';
    } else if (status !== undefined && status >= 500 || [
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH',
      'EPERM', 'EACCES', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
    ].includes(code ?? '')) {
      category = 'network_error';
    }
  }

  return {
    stage,
    category,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(apiCode === undefined ? {} : { apiErrorCode: apiCode }),
  };
}

export function formatSmokeTelegramApiDiagnostic(method: string, error: unknown): string | undefined {
  const stage = method === 'getMe' ? 'telegram_get_me'
    : method === 'deleteWebhook' ? 'telegram_delete_webhook'
      : method === 'getUpdates' ? 'telegram_get_updates' : undefined;
  if (!stage) return undefined;
  const diagnostic = classifySmokeStartupError(error, stage);
  return `Smoke Telegram API failed: stage=${diagnostic.stage}; category=${diagnostic.category}` +
    (diagnostic.apiErrorCode === undefined ? '' : `; api_error_code=${diagnostic.apiErrorCode}`) +
    (diagnostic.httpStatus === undefined ? '' : `; http_status=${diagnostic.httpStatus}`);
}
