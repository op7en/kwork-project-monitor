import type { GmailProjectReader, GmailFullMessage } from './client.js';
import type { ParserPolicy, ParseResult } from '../kwork/model.js';
import { decodeMime, MAX_MESSAGE_BYTES } from './mime.js';
import { isParserPolicy, parseProjects } from '../kwork/parser.js';
export function parseGmailMessage(message: GmailFullMessage, policy?: ParserPolicy): ParseResult {
  if (!message.id || !/^[A-Za-z0-9_-]{1,128}$/.test(message.id)) return { projects: [], diagnostics: ['invalid_payload'] };
  if (message.sizeEstimate !== undefined && message.sizeEstimate !== null &&
      (!Number.isSafeInteger(message.sizeEstimate) || message.sizeEstimate < 0 || message.sizeEstimate > MAX_MESSAGE_BYTES))
    return { projects: [], diagnostics: ['message_limit'] };
  return parseProjects(decodeMime(message.payload), message.id, policy);
}
export async function readKworkProjects(reader: GmailProjectReader, ids: readonly string[], policy?: ParserPolicy): Promise<ParseResult> {
  if (!isParserPolicy(policy))
    return { projects: [], diagnostics: ['unconfirmed_policy'] };
  if (ids.length > 50) return { projects: [], diagnostics: ['batch_limit'] };
  const result: ParseResult = { projects: [], diagnostics: [] };
  const seen = new Set<string>();
  for (const id of new Set(ids)) {
    try {
      const read = await reader.getProjectMessage(id);
      result.diagnostics.push(...read.diagnostics);
      if (!read.message) continue;
      const parsed = parseGmailMessage(read.message, policy);
      result.diagnostics.push(...parsed.diagnostics);
      for (const project of parsed.projects) {
        if (seen.has(project.projectId)) { result.diagnostics.push('duplicate_project'); continue; }
        seen.add(project.projectId); result.projects.push(project);
      }
    } catch { result.diagnostics.push('message_read_failed'); }
  }
  result.diagnostics = [...new Set(result.diagnostics)];
  return result;
}
