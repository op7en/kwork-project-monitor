import type { GmailConfig } from '../config/gmail.js';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const READONLY_GMAIL_SCOPES = new Set([
  GMAIL_READONLY_SCOPE,
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
]);
const requestOptions = { timeout: 10_000, retry: false };

export type GmailStage = 'access_token' | 'oauth_scopes' | 'profile' | 'account' |
  'messages_list' | 'message_metadata';
export type GmailErrorCategory = 'invalid_grant' | 'invalid_client' | 'access_denied' |
  'insufficient_scope' | 'network_error' | 'timeout' | 'unknown_oauth_error' |
  'unknown_api_error' | 'unsafe_gmail_scope' | 'account_mismatch';

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

export async function createGmailClient(config: GmailConfig): Promise<GmailClient> {
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    transporterOptions: requestOptions,
  });
  auth.setCredentials({ refresh_token: config.refreshToken });

  let accessToken: string;
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('Missing access token');
    accessToken = token;
  } catch (error: unknown) {
    throw safeApiError(error, 'access_token', 'Не удалось получить access token Gmail.');
  }

  let scopes: string[];
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
