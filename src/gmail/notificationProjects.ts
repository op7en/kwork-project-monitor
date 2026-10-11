import type { ParseResult } from '../kwork/model.js';
import { loadGmailConfig } from '../config/gmail.js';
import { createGmailClient, createGmailProjectReader } from './client.js';
import { findKworkEmails } from './kworkEmails.js';
import { readKworkProjects } from './projects.js';
import { KWORK_TABLE_POLICY } from '../kwork/parser.js';

/** Lazy manual operation. From is an allowlist filter, not proof of authenticity. */
export async function loadNotificationProjects(env: NodeJS.ProcessEnv = process.env): Promise<ParseResult> {
  const config = loadGmailConfig(env);
  const client = await createGmailClient(config);
  const emails = await findKworkEmails(client);
  if (emails.length === 0) return { projects: [], diagnostics: [] };
  // Public sender explicitly confirmed by the owner; account/credentials remain environment configuration.
  const reader = await createGmailProjectReader(config, ['news@kwork.ru']);
  return readKworkProjects(reader, emails.map(email => email.id), KWORK_TABLE_POLICY);
}
