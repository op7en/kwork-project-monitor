import type { Bot } from 'grammy';
import type { Chat, Update, UserFromGetMe } from 'grammy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { loadNotificationProjects } from '../src/gmail/notificationProjects.js';
import { GMAIL_READONLY_SCOPE } from '../src/gmail/client.js';
import { TABLE_HEADER, TABLE_ROW } from './fixtures/kwork-table-v1.js';

const google = vi.hoisted(() => ({ getAccessToken: vi.fn(), getTokenInfo: vi.fn(),
  setCredentials: vi.fn(), getProfile: vi.fn(), list: vi.fn(), get: vi.fn(), gmail: vi.fn() }));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {
  setCredentials = google.setCredentials; getAccessToken = google.getAccessToken; getTokenInfo = google.getTokenInfo;
} }, gmail: google.gmail } }));
const env = { GMAIL_CLIENT_ID: 'synthetic-client', GMAIL_CLIENT_SECRET: 'synthetic-secret',
  GMAIL_REFRESH_TOKEN: 'synthetic-refresh', GMAIL_EXPECTED_ACCOUNT_EMAIL: 'owner@example.com' };
const ownerId = 7654321;
const botInfo: UserFromGetMe = { id: 9001, is_bot: true, first_name: 'Synthetic bot', username: 'synthetic_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
  allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };
function update(text: string, chat: Exclude<Chat, {type: 'channel'}> = { id: ownerId, type: 'private', first_name: 'Synthetic' }, userId = ownerId): Update {
  return { update_id: 1, message: { message_id: 1, date: 0, chat,
    from: { id: userId, is_bot: false, first_name: 'Synthetic' }, text,
    entities: [{ type: 'bot_command', offset: 0, length: text.length }] } };
}
function intercept(bot: Bot, failProject = false) {
  bot.botInfo = botInfo;
  const requests: Record<string, unknown>[] = [];
  bot.api.config.use((previous, method, payload) => {
    if (method !== 'sendMessage') throw Error('Unexpected Telegram mock call');
    requests.push(payload);
    if (failProject && 'reply_markup' in payload && payload.reply_markup)
      return Promise.reject(Error('SYNTHETIC_PRIVATE_TELEGRAM_ERROR'));
    return Promise.resolve({ ok: true, result: { message_id: 2, date: 0,
      chat: { id: ownerId, type: 'private', first_name: 'Synthetic' }, from: botInfo, text: 'Synthetic response' } }) as ReturnType<typeof previous<typeof method>>;
  });
  return requests;
}
function makeBot(failProject = false) {
  const bot = createBot('test-only-placeholder', ownerId, () => loadNotificationProjects(env));
  return { bot, requests: intercept(bot, failProject) };
}
function message(id: string, full: boolean, sender = 'news@kwork.ru', content?: string) {
  const html = `<table>${TABLE_HEADER}${TABLE_ROW}${TABLE_ROW.replaceAll('9000001','9000002')
    .replace('Синтетический интерфейс','Синтетическая API интеграция').replace('5 555 ₽','7 777 ₽')}</table>`;
  return { data: { id, sizeEstimate: 5000, internalDate: '123000', payload: {
    headers: [{ name: 'Subject', value: 'Новые проекты на бирже Kwork' }, { name: 'From', value: sender }],
    ...(full ? { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Unconfirmed plain alternative').toString('base64url') } },
      { mimeType: 'text/html', body: { data: content ?? Buffer.from(html).toString('base64url') } },
    ] } : {}),
  } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  google.getAccessToken.mockResolvedValue({ token: 'synthetic-access' });
  google.getTokenInfo.mockResolvedValue({ scopes: [GMAIL_READONLY_SCOPE] });
  google.getProfile.mockResolvedValue({ data: { emailAddress: 'owner@example.com' } });
  google.gmail.mockReturnValue({ users: { getProfile: google.getProfile, messages: { list: google.list, get: google.get } } });
  google.list.mockResolvedValue({ data: { messages: [{ id: 'synthetic-email-a' }, { id: 'synthetic-email-b' }] } });
  google.get.mockImplementation(async ({id, format}: {id: string; format: string}) => message(id, format === 'full'));
});

describe('Private command → Google boundary → MIME/table → mock Telegram', () => {
  it('does no Gmail work at construction, /start, /help or /ping', async () => {
    const { bot } = makeBot();
    expect(google.getAccessToken).not.toHaveBeenCalled();
    for (const command of ['/start','/help','/ping']) await bot.handleUpdate(update(command));
    expect(google.getAccessToken).not.toHaveBeenCalled(); expect(google.list).not.toHaveBeenCalled();
  });
  it.each([
    [{id: -10001, type: 'group', title: 'Synthetic group'},ownerId],
    [{id: -10002, type: 'supergroup', title: 'Synthetic group'},ownerId],
    [{id: ownerId+1, type: 'private', first_name: 'Other'},ownerId+1],
    [{id: ownerId+1, type: 'private', first_name: 'Other'},ownerId],
  ] satisfies [Exclude<Chat,{type:'channel'}>,number][])('rejects /projects outside owner private chat %#', async (chat,userId) => {
    const { bot, requests } = makeBot(); await bot.handleUpdate(update('/projects',chat,userId));
    expect(requests).toEqual([]); expect(google.getAccessToken).not.toHaveBeenCalled();
  });
  it('sends two correctly associated projects once across duplicate emails, plus safe summary', async () => {
    const { bot, requests } = makeBot(); await bot.handleUpdate(update('/projects'));
    const projects = requests.filter(r => r['reply_markup']);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({chat_id:ownerId,text:expect.stringContaining('Название: Синтетический интерфейс\nЦена: 5 555 ₽'),
      reply_markup:{inline_keyboard:[[{text:'Открыть заказ',url:'https://kwork.ru/new_offer?project=9000001'}]]}});
    expect(projects[1]).toMatchObject({chat_id:ownerId,text:expect.stringContaining('Название: Синтетическая API интеграция\nЦена: 7 777 ₽'),
      reply_markup:{inline_keyboard:[[{text:'Открыть заказ',url:'https://kwork.ru/new_offer?project=9000002'}]]}});
    expect(requests.at(-1)?.['text']).toContain('Отправлено: 2');
    expect(JSON.stringify(requests)).not.toContain('synthetic-email');
    expect(google.list.mock.calls[0]?.[0]).toMatchObject({userId:'me',q:'subject:"Новые проекты на бирже Kwork"',includeSpamTrash:false});
    expect(google.get.mock.calls.map(c=>c[0].format)).toEqual(['metadata','metadata','metadata','full','metadata','full']);
    expect(google.getTokenInfo.mock.calls).toHaveLength(2);
  });
  it('does not create a body reader for an empty selection', async () => {
    google.list.mockResolvedValue({data:{messages:[]}});
    const {bot,requests}=makeBot(); await bot.handleUpdate(update('/projects'));
    expect(google.getTokenInfo).toHaveBeenCalledTimes(1); expect(google.get).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('Извлечено: 0');
  });
  it.each(['scopes','account','list'] as const)('contains Gmail %s errors without private error text or project sends', async stage => {
    if(stage==='scopes') google.getTokenInfo.mockResolvedValue({scopes:[]});
    if(stage==='account') google.getProfile.mockResolvedValue({data:{emailAddress:'other@example.com'}});
    if(stage==='list') google.list.mockRejectedValue(Error('SYNTHETIC_PRIVATE_GMAIL_ERROR'));
    const {bot,requests}=makeBot(); await bot.handleUpdate(update('/projects'));
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('Не удалось выполнить Gmail');
    expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_PRIVATE'); expect(google.get).not.toHaveBeenCalled();
  });
  it('rejects an unconfirmed From at metadata without any full read', async () => {
    google.get.mockImplementation(async ({id}: {id:string}) => message(id,false,'attacker@example.com'));
    const {bot,requests}=makeBot(); await bot.handleUpdate(update('/projects'));
    expect(google.get.mock.calls.every(c=>c[0].format==='metadata')).toBe(true);
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('message_rejected');
  });
  it.each(['corrupt','read'] as const)('reports %s body failure without project messages', async kind => {
    google.get.mockImplementation(async ({id,format}: {id:string;format:string}) => {
      if(kind==='read' && format==='full') throw Error('SYNTHETIC_PRIVATE_GMAIL_ERROR');
      return message(id,format==='full','news@kwork.ru',kind==='corrupt'?'%%%':undefined);
    });
    const {bot,requests}=makeBot(); await bot.handleUpdate(update('/projects'));
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain(kind==='corrupt'?'invalid_base64url':'message_read_failed');
    expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('counts Telegram failures without retrying duplicate projects or reporting success', async () => {
    const {bot,requests}=makeBot(true); await bot.handleUpdate(update('/projects'));
    expect(requests.filter(r=>r['reply_markup'])).toHaveLength(2);
    expect(requests.at(-1)?.['text']).toContain('Отправлено: 0'); expect(requests.at(-1)?.['text']).toContain('Ошибки отправки: 2');
    expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('reports unrecognizable HTML without inventing projects', async () => {
    google.get.mockImplementation(async ({id,format}: {id:string;format:string}) => message(id,format==='full',
      'news@kwork.ru',Buffer.from('<table><tr><td>Broken synthetic layout').toString('base64url')));
    const {bot,requests}=makeBot(); await bot.handleUpdate(update('/projects'));
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('Извлечено: 0');
    expect(requests[0]?.['text']).toContain('no_project_blocks');
  });
  it('keeps one active command pipeline and returns busy without another Gmail selection', async () => {
    let release!: (value: {data:{messages:[]}}) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    google.list.mockImplementation(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const {bot,requests}=makeBot();
    const first=bot.handleUpdate(update('/projects')); await started;
    await bot.handleUpdate(update('/projects'));
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('ещё выполняется');
    expect(google.list).toHaveBeenCalledTimes(1);
    release({data:{messages:[]}}); await first;
    expect(requests).toHaveLength(2); expect(requests[1]?.['text']).toContain('Извлечено: 0');
  });
  it('returns a safe failure for missing Gmail configuration without authentication', async () => {
    const bot=createBot('test-only-placeholder',ownerId,()=>loadNotificationProjects({}));
    const requests=intercept(bot); await bot.handleUpdate(update('/projects'));
    expect(requests).toHaveLength(1); expect(requests[0]?.['text']).toContain('Не удалось выполнить Gmail');
    expect(google.getAccessToken).not.toHaveBeenCalled();
  });
});
