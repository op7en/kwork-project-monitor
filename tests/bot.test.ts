import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/bot.js';

const botInfo: UserFromGetMe = {
  id: 9001,
  is_bot: true,
  first_name: 'Test bot',
  username: 'kwork_monitor_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function messageUpdate(text: string): Update {
  const command = text.split(' ')[0] ?? text;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: { id: 1001, is_bot: false, first_name: 'Test user' },
      chat: { id: 1001, type: 'private', first_name: 'Test user' },
      text,
      ...(text.startsWith('/')
        ? { entities: [{ type: 'bot_command' as const, offset: 0, length: command.length }] }
        : {}),
    },
  };
}

async function repliesTo(text: string) {
  // An obvious test placeholder, never a real secret. Network calls are intercepted.
  const bot = createBot('test-only-placeholder');
  bot.botInfo = botInfo;
  const requests: { method: string; payload: unknown }[] = [];

  bot.api.config.use((_previous, method, payload) => {
    if (method !== 'sendMessage') throw new Error(`Unexpected API call: ${method}`);
    requests.push({ method, payload });
    const response = {
      ok: true,
      result: {
        message_id: 2,
        date: 0,
        chat: { id: 1001, type: 'private', first_name: 'Test user' },
        from: botInfo,
        text: 'Offline API response',
      },
    };
    // The guard above limits this generic transformer to sendMessage only.
    return Promise.resolve(response) as ReturnType<typeof _previous<typeof method>>;
  });

  await bot.handleUpdate(messageUpdate(text));
  return requests;
}

describe('Telegram commands without network', () => {
  it('replies pong to /ping in the originating chat', async () => {
    expect(await repliesTo('/ping')).toEqual([
      { method: 'sendMessage', payload: { chat_id: 1001, text: 'pong' } },
    ]);
  });

  it('welcomes the user and describes the purpose on /start', async () => {
    const requests = await repliesTo('/start');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'sendMessage',
      payload: { chat_id: 1001, text: expect.stringMatching(/Привет.*Kwork/s) },
    });
    expect(requests[0]).toMatchObject({
      payload: { text: expect.stringMatching(/мониторинг/i) },
    });
  });

  it('lists every supported command on /help', async () => {
    const requests = await repliesTo('/help');
    expect(requests).toHaveLength(1);
    for (const command of ['/start', '/help', '/ping']) {
      expect(requests[0]).toMatchObject({
        method: 'sendMessage',
        payload: { chat_id: 1001, text: expect.stringContaining(command) },
      });
    }
  });

  it('accepts commands explicitly addressed to this bot', async () => {
    expect(await repliesTo('/ping@kwork_monitor_test_bot')).toEqual([
      { method: 'sendMessage', payload: { chat_id: 1001, text: 'pong' } },
    ]);
  });

  it.each(['/ping@another_bot', '/unknown', 'hello'])('ignores unrelated input: %s', async (text) => {
    expect(await repliesTo(text)).toEqual([]);
  });
});
