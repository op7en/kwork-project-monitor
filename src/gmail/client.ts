import type { GmailConfig } from '../config/gmail.js';
import { MAX_MESSAGE_BYTES, type MessagePart } from './mime.js';
import type { Diagnostic } from '../kwork/model.js';
import { KWORK_SUBJECT } from './kworkEmails.js';
import type { MonitoringGmail } from './monitorClient.js';

export interface GmailFullMessage { id?: string | null; sizeEstimate?: number | null; payload?: MessagePart | null }
export interface GmailProjectReader {
  getProjectMessage(id: string): Promise<{ message?: GmailFullMessage; diagnostics: Diagnostic[] }>;
}
const mailboxPattern = /^[a-z0-9._+-]+@[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/i;
function senderFrom(value: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- Reject untrusted header control bytes explicitly.
  if (value.length > 320 || /[\u0000-\u001f\u007f,;]/u.test(value)) return undefined;
  const bare = value.trim();
  if (mailboxPattern.test(bare)) return bare.toLowerCase();
  const display = /^[^<>]+<([^<>]+)>$/.exec(bare);
  const mailbox = display?.[1]?.trim();
  return mailbox && mailboxPattern.test(mailbox) ? mailbox.toLowerCase() : undefined;
}
function trustedHeaders(headers: MessagePart['headers'], allowed: ReadonlySet<string>): boolean {
  if (!Array.isArray(headers) || headers.length > 100) return false;
  const values = (name: string): Array<string | null | undefined> => headers
    .filter(h => typeof h?.name === 'string' && h.name.toLowerCase() === name).map(h => h.value);
  const subjects = values('subject'), senders = values('from');
  if (subjects.length !== 1 || subjects[0] !== KWORK_SUBJECT || senders.length !== 1 || typeof senders[0] !== 'string') return false;
  const sender = senderFrom(senders[0]);
  return sender !== undefined && allowed.has(sender);
}
function permittedMessage(message: GmailFullMessage, id: string, allowed: ReadonlySet<string>): boolean {
  return message.id === id && typeof message.sizeEstimate === 'number' && Number.isSafeInteger(message.sizeEstimate) &&
    message.sizeEstimate >= 0 && message.sizeEstimate <= MAX_MESSAGE_BYTES && trustedHeaders(message.payload?.headers, allowed);
}
interface ReaderOptions { notBefore?: number; shouldContinue?: () => boolean }
function validFloor(floor: number | undefined): void {
  if (floor !== undefined && (!Number.isSafeInteger(floor) || floor < 0))
    throw new GmailError('Некорректная граница инициализации.', 'message_metadata', 'unknown_api_error');
}
function senderPolicy(allowedSenders: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(allowedSenders) || allowedSenders.length === 0 || allowedSenders.length > 20 ||
      allowedSenders.some(sender => typeof sender !== 'string' || sender.length > 254 || !mailboxPattern.test(sender))) {
    throw new GmailError('Требуется явно подтверждённый sender allowlist.', 'sender_policy', 'invalid_sender_policy');
  }
  return new Set(allowedSenders.map(sender => sender.toLowerCase()));
}
export async function createGmailProjectReader(config: GmailConfig, allowedSenders: readonly string[],
  options: ReaderOptions = {}): Promise<GmailProjectReader> {
  validFloor(options.notBefore);
  const allowed = senderPolicy(allowedSenders);
  return projectReader(await verifiedGmailApi(config, options.shouldContinue), allowed, options);
}
function projectReader(gmail: Awaited<ReturnType<typeof verifiedGmailApi>>, allowed: ReadonlySet<string>,
  options: ReaderOptions): GmailProjectReader {
  return {
    async getProjectMessage(id) {
      if (options.shouldContinue && !options.shouldContinue()) return { diagnostics: ['operation_cancelled'] };
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { diagnostics: ['message_rejected'] };
      let metadata: GmailFullMessage;
      try {
        const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata',
          metadataHeaders: ['Subject', 'From'], fields: options.notBefore === undefined
            ? 'id,sizeEstimate,payload/headers' : 'id,internalDate,sizeEstimate,payload/headers' }, requestOptions);
        metadata = data;
      } catch (error: unknown) { throw safeApiError(error, 'message_metadata', 'Не удалось проверить metadata сообщения.'); }
      if (!permittedMessage(metadata, id, allowed)) return { diagnostics: ['message_rejected'] };
      if (options.notBefore !== undefined) {
        const internalDate = (metadata as GmailFullMessage & { internalDate?: string }).internalDate;
        const timestamp = typeof internalDate === 'string' && /^\d{1,16}$/.test(internalDate) ? Number(internalDate) : NaN;
        if (!Number.isSafeInteger(timestamp)) return { diagnostics: ['message_rejected'] };
        if (timestamp < options.notBefore) return { diagnostics: ['historical_message'] };
      }
      if (options.shouldContinue && !options.shouldContinue()) return { diagnostics: ['operation_cancelled'] };
      let full: GmailFullMessage;
      try {
        const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full', fields: 'id,sizeEstimate,payload' }, requestOptions);
        full = data;
      } catch (error: unknown) { throw safeApiError(error, 'message_full', 'Не удалось получить содержимое сообщения.'); }
      if (!permittedMessage(full, id, allowed)) return { diagnostics: ['message_rejected'] };
      return { message: { id: full.id!, sizeEstimate: full.sizeEstimate!, payload: full.payload! }, diagnostics: [] };
    },
  };
}

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const READONLY_GMAIL_SCOPES = new Set([
  GMAIL_READONLY_SCOPE,
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
]);
const requestOptions = { timeout: 10_000, retry: false };

export type GmailStage = 'access_token' | 'oauth_scopes' | 'profile' | 'account' |
  'messages_list' | 'message_metadata' | 'message_full' | 'sender_policy' | 'history_cursor' | 'history_list';
export type GmailErrorCategory = 'invalid_grant' | 'invalid_client' | 'access_denied' |
  'insufficient_scope' | 'network_error' | 'timeout' | 'unknown_oauth_error' |
  'unknown_api_error' | 'unsafe_gmail_scope' | 'account_mismatch' | 'invalid_sender_policy' | 'history_expired' | 'operation_cancelled';

export class GmailError extends Error {
  declare readonly httpStatus?: number;

  constructor(message: string, readonly stage: GmailStage,
    readonly category: GmailErrorCategory, httpStatus?: number) {
    super(message);
    this.name = 'GmailError';
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function safeApiError(error: unknown, stage: GmailStage, message: string): GmailError {
  // Inspect only approved fields. Never retain a raw error, URL, description,
  // request/config, headers or cause on the application error.
  const raw = record(error);
  const response = record(raw?.['response']);
  const oauthCode = record(response?.['data'])?.['error'];
  const status = response?.['status'];
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status : undefined;
  let category: GmailErrorCategory = stage === 'access_token' || stage === 'oauth_scopes'
    ? 'unknown_oauth_error' : 'unknown_api_error';
  if (oauthCode === 'invalid_grant' || oauthCode === 'invalid_client' ||
      oauthCode === 'access_denied' || oauthCode === 'insufficient_scope') {
    category = oauthCode;
  } else {
    const code = raw?.['code'] ?? record(raw?.['cause'])?.['code'];
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' ||
        raw?.['name'] === 'TimeoutError' || raw?.['name'] === 'AbortError') category = 'timeout';
    else if (typeof code === 'string' && [
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH',
      'EPERM', 'EACCES', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
    ].includes(code)) category = 'network_error';
  }
  return new GmailError(message, stage, category, httpStatus);
}

export interface GmailMetadata {
  id: string | undefined;
  threadId: string | undefined;
  internalDate: string | undefined;
  headers: ReadonlyArray<{ name?: string | null; value?: string | null }>;
}

export interface GmailClient {
  listMessages(query: string, maxResults: number, pageToken?: string): Promise<{
    ids: string[];
    nextPageToken: string | undefined;
  }>;
  getMessageMetadata(id: string): Promise<GmailMetadata>;
}

async function verifiedGmailApi(config: GmailConfig, shouldContinue: () => boolean = () => true) {
  const check = (stage: GmailStage): void => {
    if (!shouldContinue()) throw new GmailError('Операция отменена.', stage, 'operation_cancelled');
  };
  check('access_token');
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    transporterOptions: requestOptions,
  });
  auth.setCredentials({ refresh_token: config.refreshToken });

  let accessToken: string;
  check('access_token'); // dynamic import above yields; stop may have arrived before the first request
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('Missing access token');
    accessToken = token;
  } catch (error: unknown) {
    throw safeApiError(error, 'access_token', 'Не удалось получить access token Gmail.');
  }

  let scopes: string[];
  check('oauth_scopes');
  try {
    // A refresh token retains its original grants; setting a scope locally does
    // not narrow them. Inspect the actual token before accessing the mailbox.
    scopes = (await auth.getTokenInfo(accessToken)).scopes;
  } catch (error: unknown) {
    throw safeApiError(error, 'oauth_scopes', 'Не удалось проверить OAuth scopes Gmail.');
  }

  if (!Array.isArray(scopes) || !scopes.includes(GMAIL_READONLY_SCOPE)) {
    throw new GmailError('Для Gmail требуется scope gmail.readonly. Получите новый refresh token с этим разрешением.',
      'oauth_scopes', 'insufficient_scope');
  }
  if (scopes.some((scope) =>
    (scope.startsWith('https://www.googleapis.com/auth/gmail') && !READONLY_GMAIL_SCOPES.has(scope)) ||
    scope === 'https://mail.google.com/' || scope === 'https://mail.google.com')) {
    throw new GmailError('Gmail OAuth имеет широкие или неизвестные Gmail permissions. Требуется READ ONLY доступ.',
      'oauth_scopes', 'unsafe_gmail_scope');
  }

  const gmail = google.gmail({ version: 'v1', auth });
  let email: string | undefined;
  check('profile');
  try {
    const { data } = await gmail.users.getProfile({ userId: 'me', fields: 'emailAddress' }, requestOptions);
    email = data.emailAddress?.trim().toLowerCase();
  } catch (error: unknown) {
    throw safeApiError(error, 'profile', 'Не удалось проверить Gmail аккаунт.');
  }
  if (!email || email !== config.expectedAccountEmail.trim().toLowerCase()) {
    throw new GmailError('Gmail аккаунт не соответствует GMAIL_EXPECTED_ACCOUNT_EMAIL. Операция остановлена.',
      'account', 'account_mismatch');
  }
  return gmail;
}

export async function createGmailClient(config: GmailConfig): Promise<GmailClient> {
  const gmail = await verifiedGmailApi(config);

  // Return only read operations after both permission and identity checks pass.
  return {
    async listMessages(query, maxResults, pageToken) {
      try {
        const { data } = await gmail.users.messages.list({
          userId: 'me', q: query, maxResults, includeSpamTrash: false,
          fields: 'messages/id,nextPageToken', ...(pageToken ? { pageToken } : {}),
        }, requestOptions);
        return {
          ids: (data.messages ?? []).map((message) => message.id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
          nextPageToken: data.nextPageToken ?? undefined,
        };
      } catch (error: unknown) {
        throw safeApiError(error, 'messages_list', 'Не удалось получить список Gmail сообщений.');
      }
    },
    async getMessageMetadata(id) {
      try {
        const { data } = await gmail.users.messages.get({
          userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject'],
          fields: 'id,threadId,internalDate,payload/headers',
        }, requestOptions);
        return {
          id: data.id ?? undefined, threadId: data.threadId ?? undefined,
          internalDate: data.internalDate ?? undefined, headers: data.payload?.headers ?? [],
        };
      } catch (error: unknown) {
        throw safeApiError(error, 'message_metadata', 'Не удалось получить metadata Gmail сообщения.');
      }
    },
  };
}

/** One verified READ ONLY API instance shared by history discovery and the existing metadata/body gate. */
export async function createGmailMonitoringClient(config: GmailConfig, notBefore?: number,
  shouldContinue: () => boolean = () => true): Promise<MonitoringGmail> {
  validFloor(notBefore);
  const allowed = senderPolicy(['news@kwork.ru']);
  const gmail = await verifiedGmailApi(config, shouldContinue);
  return {
    reader: projectReader(gmail, allowed, { ...(notBefore === undefined ? {} : { notBefore }), shouldContinue }),
    async currentHistoryId() {
      if (!shouldContinue()) throw new GmailError('Операция отменена.', 'history_cursor', 'operation_cancelled');
      try {
        const { data } = await gmail.users.getProfile({ userId: 'me', fields: 'historyId' }, requestOptions);
        if (!data.historyId || !/^[1-9]\d{0,39}$/.test(data.historyId)) throw new Error('Invalid cursor');
        return data.historyId;
      } catch (error) { throw safeApiError(error, 'history_cursor', 'Не удалось проверить Gmail cursor.'); }
    },
    async historyPage(startHistoryId, pageToken) {
      if (!shouldContinue()) throw new GmailError('Операция отменена.', 'history_list', 'operation_cancelled');
      try {
        const { data } = await gmail.users.history.list({ userId: 'me', startHistoryId, historyTypes: ['messageAdded'],
          maxResults: 100, fields: 'historyId,nextPageToken,history(id,messagesAdded/message/id)',
          ...(pageToken === undefined ? {} : { pageToken }) }, requestOptions);
        return { historyId: data.historyId ?? '', ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
          records: (data.history ?? []).map(record => ({ historyId: record.id ?? '',
            messageIds: (record.messagesAdded ?? []).map(added => added.message?.id ?? '') })) };
      } catch (error) {
        const safe = safeApiError(error, 'history_list', 'Не удалось получить историю Gmail.');
        if (safe.httpStatus === 404) throw new GmailError('Gmail cursor истёк.', 'history_list', 'history_expired', 404);
        throw safe;
      }
    },
  };
}
