import { describe, expect, it } from 'vitest';
import { GrammyError, HttpError } from 'grammy';
import { classifySmokeStartupError, formatSmokeTelegramApiDiagnostic } from '../src/smoke/startupError.js';

describe('classifySmokeStartupError', () => {
  it.each([401, 403])('classifies Telegram auth status %i without exposing exception details', status => {
    const error = new GrammyError('private token-bearing error text', {
      ok: false,
      error_code: status,
      description: 'private API description',
    }, 'getMe', { token: 'private-token' });

    expect(classifySmokeStartupError(error)).toEqual({
      stage: 'telegram_startup',
      category: 'telegram_auth_error',
      apiErrorCode: status,
    });
  });

  it('classifies a Telegram polling conflict', () => {
    const error = new GrammyError('private conflict text', {
      ok: false,
      error_code: 409,
      description: 'private conflict description',
    }, 'deleteWebhook', {});

    expect(classifySmokeStartupError(error)).toEqual({
      stage: 'telegram_startup',
      category: 'telegram_conflict',
      apiErrorCode: 409,
    });
  });

  it('uses only a numeric HTTP status from a wrapped transport error', () => {
    expect(classifySmokeStartupError(new HttpError('private HTTP text', { status: 403, body: 'private' }))).toEqual({
      stage: 'telegram_startup',
      category: 'telegram_auth_error',
      httpStatus: 403,
    });
    expect(classifySmokeStartupError(new HttpError('private HTTP text', { statusCode: 503 }))).toEqual({
      stage: 'telegram_startup',
      category: 'network_error',
      httpStatus: 503,
    });
  });

  it('classifies network and timeout causes wrapped by grammY', () => {
    expect(classifySmokeStartupError(new HttpError('private network message', Object.assign(new Error('private'), { code: 'ECONNRESET' })))).toEqual({
      stage: 'telegram_startup',
      category: 'network_error',
    });
    expect(classifySmokeStartupError(new HttpError('private timeout message', Object.assign(new Error('private'), { code: 'ETIMEDOUT' })))).toEqual({
      stage: 'telegram_startup',
      category: 'timeout',
    });
    expect(classifySmokeStartupError(new HttpError('private timeout message', new Error("Request to 'getMe' timed out after 500 seconds")))).toEqual({
      stage: 'telegram_startup',
      category: 'timeout',
    });
  });

  it('classifies unknown startup failures without returning raw error content', () => {
    const error = new Error('https://api.telegram.org/bot/private-token');
    expect(classifySmokeStartupError(error)).toEqual({
      stage: 'telegram_startup',
      category: 'initialization_error',
    });
  });
});

describe('formatSmokeTelegramApiDiagnostic', () => {
  it('maps only known startup methods to fixed diagnostic stages', () => {
    expect(formatSmokeTelegramApiDiagnostic('getMe', { error_code: 404 })).toBe(
      'Smoke Telegram API failed: stage=telegram_get_me; category=initialization_error; api_error_code=404',
    );
    expect(formatSmokeTelegramApiDiagnostic('deleteWebhook', { error_code: 404 })).toBe(
      'Smoke Telegram API failed: stage=telegram_delete_webhook; category=initialization_error; api_error_code=404',
    );
    expect(formatSmokeTelegramApiDiagnostic('getUpdates', Object.assign(new Error('private'), { code: 'ECONNRESET' }))).toBe(
      'Smoke Telegram API failed: stage=telegram_get_updates; category=network_error',
    );
    expect(formatSmokeTelegramApiDiagnostic('sendMessage', { error_code: 404 })).toBeUndefined();
  });
});
