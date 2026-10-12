import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_ID_PATTERN } from '../config/smoke.js';

/** Reads only the previously created ignored metadata mapping; never returns or logs an ID. */
export function selectedIdMatchesCandidateOne(messageId: string, mapping: unknown): boolean {
  if (!MESSAGE_ID_PATTERN.test(messageId) || typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) return false;
  const candidates = (mapping as Record<string, unknown>)['candidates'];
  if (!Array.isArray(candidates)) return false;
  const first = candidates.filter(candidate => typeof candidate === 'object' && candidate !== null &&
    !Array.isArray(candidate) && (candidate as Record<string, unknown>)['number'] === 1);
  if (first.length !== 1) return false;
  const id = (first[0] as Record<string, unknown>)['id'];
  return typeof id === 'string' && MESSAGE_ID_PATTERN.test(id) && id === messageId;
}

export function readSelectedIdMatchesCandidateOne(messageId: string): boolean {
  try {
    const content = readFileSync(join(process.cwd(), '.local-acceptance', 'live-smoke-candidates.json'), 'utf8');
    return selectedIdMatchesCandidateOne(messageId, JSON.parse(content) as unknown);
  } catch {
    return false;
  }
}
