import type { GmailClient, GmailMetadata } from './client.js';

export const KWORK_SUBJECT = 'Новые проекты на бирже Kwork';
const CANDIDATE_LIMIT = 50;
const PAGE_LIMIT = 5;
const RESULT_LIMIT = 5;

export interface KworkEmail {
  id: string;
  threadId?: string;
  receivedAt?: Date;
  subject: string;
}

function matchingEmail(metadata: GmailMetadata): KworkEmail | undefined {
  const subjects = metadata.headers.filter((header) => header.name?.toLowerCase() === 'subject');
  if (!metadata.id || subjects.length !== 1 || subjects[0]?.value !== KWORK_SUBJECT) return undefined;

  const email: KworkEmail = { id: metadata.id, subject: KWORK_SUBJECT };
  if (metadata.threadId) email.threadId = metadata.threadId;
  if (metadata.internalDate && /^\d+$/.test(metadata.internalDate)) {
    const timestamp = Number(metadata.internalDate);
    const date = new Date(timestamp);
    if (Number.isSafeInteger(timestamp) && Number.isFinite(date.getTime())) email.receivedAt = date;
  }
  return email;
}

export async function findKworkEmails(client: GmailClient): Promise<KworkEmail[]> {
  const matches: KworkEmail[] = [];
  let candidates = 0;
  let pageToken: string | undefined;
  for (let page = 0; page < PAGE_LIMIT && candidates < CANDIDATE_LIMIT; page++) {
    const remaining = CANDIDATE_LIMIT - candidates;
    const result = await client.listMessages(`subject:"${KWORK_SUBJECT}"`, remaining, pageToken);
    const ids = result.ids.slice(0, remaining);
    candidates += ids.length;
    for (const id of ids) {
      const email = matchingEmail(await client.getMessageMetadata(id));
      if (email) matches.push(email);
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  // Newest within the bounded sample, not a complete mailbox enumeration.
  return matches.sort((a, b) => (b.receivedAt?.getTime() ?? 0) - (a.receivedAt?.getTime() ?? 0))
    .slice(0, RESULT_LIMIT);
}
