import { describe, expect, it, vi } from 'vitest';
import type { GmailClient, GmailMetadata } from '../src/gmail/client.js';
import { findKworkEmails, KWORK_SUBJECT } from '../src/gmail/kworkEmails.js';

function metadata(id = 'm1', subject = KWORK_SUBJECT): GmailMetadata {
  return { id, threadId: undefined, internalDate: undefined, headers: [{ name: 'Subject', value: subject }] };
}

function fakeClient() {
  const listMessages = vi.fn<GmailClient['listMessages']>().mockResolvedValue({ ids: ['m1'], nextPageToken: undefined });
  const getMessageMetadata = vi.fn<GmailClient['getMessageMetadata']>().mockResolvedValue(metadata());
  return { listMessages, getMessageMetadata };
}

describe('Kwork email metadata search', () => {
  it('uses subject search and returns only exact matching minimal metadata', async () => {
    const client = fakeClient();
    client.getMessageMetadata.mockResolvedValue({
      ...metadata(), threadId: 't1', internalDate: '1700000000000',
    });
    expect(await findKworkEmails(client)).toEqual([{
      id: 'm1', threadId: 't1', receivedAt: new Date(1700000000000), subject: KWORK_SUBJECT,
    }]);
    expect(client.listMessages).toHaveBeenCalledWith(`subject:"${KWORK_SUBJECT}"`, 50, undefined);
  });

  it.each(['Новые проекты на бирже Kwork!', 'Re: Новые проекты на бирже Kwork', 'Новые проекты на бирже Kwork '])(
    'rejects similar but non-exact Subject %s', async (subject) => {
      const client = fakeClient();
      client.getMessageMetadata.mockResolvedValue(metadata('m1', subject));
      expect(await findKworkEmails(client)).toEqual([]);
    },
  );

  it('returns an empty list when no messages exist', async () => {
    const client = fakeClient();
    client.listMessages.mockResolvedValue({ ids: [], nextPageToken: undefined });
    expect(await findKworkEmails(client)).toEqual([]);
    expect(client.getMessageMetadata).not.toHaveBeenCalled();
  });

  it('handles Subject header names case-insensitively but rejects ambiguous headers', async () => {
    const client = fakeClient();
    client.getMessageMetadata.mockResolvedValue({ ...metadata(), headers: [{ name: 'sUbJeCt', value: KWORK_SUBJECT }] });
    expect(await findKworkEmails(client)).toHaveLength(1);
    client.getMessageMetadata.mockResolvedValue({ ...metadata(), headers: [
      { name: 'Subject', value: KWORK_SUBJECT }, { name: 'Subject', value: 'Different' },
    ] });
    expect(await findKworkEmails(client)).toEqual([]);
  });

  it('discards missing ID or Subject and omits missing or invalid optional metadata', async () => {
    const client = fakeClient();
    client.getMessageMetadata.mockResolvedValue({ ...metadata(), id: undefined });
    expect(await findKworkEmails(client)).toEqual([]);
    client.getMessageMetadata.mockResolvedValue({ ...metadata(), headers: [] });
    expect(await findKworkEmails(client)).toEqual([]);
    client.getMessageMetadata.mockResolvedValue({ ...metadata(), internalDate: 'invalid' });
    expect(await findKworkEmails(client)).toEqual([{ id: 'm1', subject: KWORK_SUBJECT }]);
  });

  it('uses page tokens and sorts matching dates newest first within the sample', async () => {
    const client = fakeClient();
    client.listMessages.mockResolvedValueOnce({ ids: ['old'], nextPageToken: 'next' })
      .mockResolvedValueOnce({ ids: ['new'], nextPageToken: undefined });
    client.getMessageMetadata.mockImplementation(async (id) => ({
      ...metadata(id), internalDate: id === 'old' ? '1000' : '2000',
    }));
    expect((await findKworkEmails(client)).map((mail) => mail.id)).toEqual(['new', 'old']);
    expect(client.listMessages).toHaveBeenLastCalledWith(`subject:"${KWORK_SUBJECT}"`, 49, 'next');
  });

  it('bounds candidates to 50 and output to five messages', async () => {
    const client = fakeClient();
    client.listMessages.mockResolvedValue({ ids: Array.from({ length: 60 }, (_, i) => `m${i}`), nextPageToken: 'more' });
    client.getMessageMetadata.mockImplementation(async (id) => metadata(id));
    expect(await findKworkEmails(client)).toHaveLength(5);
    expect(client.getMessageMetadata).toHaveBeenCalledTimes(50);
    expect(client.listMessages).toHaveBeenCalledTimes(1);
  });

  it('bounds pages even if Gmail returns empty pages with repeated tokens', async () => {
    const client = fakeClient();
    client.listMessages.mockResolvedValue({ ids: [], nextPageToken: 'repeated' });
    expect(await findKworkEmails(client)).toEqual([]);
    expect(client.listMessages).toHaveBeenCalledTimes(5);
  });
});
