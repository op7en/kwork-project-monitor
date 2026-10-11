import { TextDecoder } from 'node:util';
import type { Diagnostic } from '../kwork/model.js';
export interface MessagePart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: ReadonlyArray<{ name?: string | null; value?: string | null }> | null;
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  parts?: ReadonlyArray<MessagePart> | null;
}
export interface BodySegment { html: string[]; text: string[] }
export interface DecodedBody extends BodySegment { diagnostics: Diagnostic[]; segments?: BodySegment[] }
export const MAX_MESSAGE_BYTES = 1_048_576;
const MAX_ENCODED_BYTES = 2_097_152;
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
export function decodeMime(payload: unknown): DecodedBody {
  const result: DecodedBody = { html: [], text: [], diagnostics: [] };
  let nodes = 0, encoded = 0, decoded = 0;
  let fatal: Diagnostic | undefined;
  const segments: BodySegment[] = [];
  // Bound the entire input tree, including ignored attachments, before any decoding.
  const pending = [{ value: payload, depth: 0 }];
  let inputNodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++inputNodes > 128 || item.depth > 16) return { html: [], text: [], diagnostics: ['mime_limit'] };
    const part = object(item.value);
    const data = object(part?.['body'])?.['data'];
    if (typeof data === 'string') encoded += data.length;
    if (encoded > MAX_ENCODED_BYTES) return { html: [], text: [], diagnostics: ['message_limit'] };
    if (Array.isArray(part?.['parts'])) {
      if (part['parts'].length > 128) return { html: [], text: [], diagnostics: ['mime_limit'] };
      for (const value of part['parts']) pending.push({ value, depth: item.depth + 1 });
    }
  }
  const issue = (code: Diagnostic) => { if (!result.diagnostics.includes(code)) result.diagnostics.push(code); };
  const visit = (value: unknown, depth: number, independent: boolean): void => {
    if (fatal) return;
    if (++nodes > 128 || depth > 16) { fatal = 'mime_limit'; return; }
    const part = object(value);
    if (!part || typeof part['mimeType'] !== 'string') { issue('invalid_payload'); return; }
    const mime = part['mimeType'].toLowerCase();
    const headers = part['headers'] ?? [];
    if (!Array.isArray(headers) || headers.length > 100) { issue('invalid_payload'); return; }
    const headerValues = (name: string): string[] => headers.flatMap(h => {
      const header = object(h);
      return typeof header?.['name'] === 'string' && header['name'].toLowerCase() === name &&
        typeof header['value'] === 'string' ? [header['value']] : [];
    });
    const dispositions = headerValues('content-disposition');
    if (part['filename'] || dispositions.length > 1 || (dispositions.length === 1 &&
        !/^\s*inline\s*(?:;|$)/i.test(dispositions[0]!))) return;
    if (mime === 'message/rfc822') return;
    if (['multipart/alternative', 'multipart/mixed', 'multipart/related'].includes(mime)) {
      if (!Array.isArray(part['parts'])) { issue('invalid_payload'); return; }
      const htmlStart = result.html.length, textStart = result.text.length;
      for (const child of part['parts']) visit(child, depth + 1, mime === 'multipart/mixed' && independent);
      if (mime !== 'multipart/mixed' && independent)
        segments.push({ html: result.html.slice(htmlStart), text: result.text.slice(textStart) });
      return;
    }
    if (mime !== 'text/html' && mime !== 'text/plain') { issue('unsupported_mime'); return; }
    const body = object(part['body']);
    if (!body) { issue('invalid_payload'); return; }
    if (body['attachmentId']) { issue('attachment_required'); return; }
    const data = body['data'];
    if (typeof data !== 'string' || data === '') { issue('empty_body'); return; }
    // Validate before normalization; unanchored padding removal can retry quadratically on corrupt data.
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(data)) { issue('invalid_base64url'); return; }
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    const bare = padding ? data.slice(0, -padding) : data;
    const remainder = bare.length % 4;
    if (remainder === 1 ||
        (padding > 0 && (data.length % 4 !== 0 || padding !== (4 - remainder) % 4))) {
      issue('invalid_base64url'); return;
    }
    const bytes = Buffer.from(data, 'base64url');
    if (bytes.toString('base64url') !== bare) { issue('invalid_base64url'); return; }
    decoded += bytes.length;
    if (decoded > MAX_MESSAGE_BYTES) { fatal = 'message_limit'; return; }
    const contentTypes = headerValues('content-type');
    if (contentTypes.length > 1) { issue('invalid_payload'); return; }
    const contentType = contentTypes[0];
    if (contentType && (contentType.length > 1_024 || contentType.split(';')[0]?.trim().toLowerCase() !== mime)) {
      issue('invalid_payload'); return;
    }
    const charsets = contentType ? [...contentType.matchAll(/;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]+))/gi)] : [];
    if (charsets.length > 1 || (contentType && /;\s*charset\b/i.test(contentType) && charsets.length === 0)) { issue('invalid_payload'); return; }
    const charset = (charsets[0]?.[1] ?? charsets[0]?.[2] ?? 'utf-8').toLowerCase();
    if (!['utf-8', 'utf8', 'windows-1251', 'cp1251', 'windows-1252', 'iso-8859-1', 'utf-16le', 'utf-16be'].includes(charset)) {
      issue('unsupported_charset'); return;
    }
    let decoder: TextDecoder;
    try { decoder = new TextDecoder(charset, { fatal: true }); }
    catch { issue('unsupported_charset'); return; }
    try {
      const text = decoder.decode(bytes);
      if (text.trim()) {
        (mime === 'text/html' ? result.html : result.text).push(text);
        if (independent) segments.push({ html: mime === 'text/html' ? [text] : [], text: mime === 'text/plain' ? [text] : [] });
      }
    } catch { issue('invalid_text'); }
  };
  visit(payload, 0, true);
  if (fatal) return { html: [], text: [], diagnostics: [fatal] };
  if (!result.html.length && !result.text.length) issue('empty_body');
  if (segments.length > 1) result.segments = segments;
  return result;
}
