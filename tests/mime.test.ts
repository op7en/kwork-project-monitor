import { expect, it } from 'vitest';
import { decodeMime, type MessagePart } from '../src/gmail/mime.js';
const leaf = (text: string, mimeType = 'text/plain'): MessagePart => ({
  mimeType, body: { data: Buffer.from(text).toString('base64url') },
});
it('decodes nested MIME alternatives as separate representations without concatenation', () => {
  const result = decodeMime({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative',
    parts: [leaf('Проект'), { mimeType: 'multipart/related', parts: [leaf('<article>Проект</article>', 'text/html')] }] }] });
  expect(result).toEqual({ text: ['Проект'], html: ['<article>Проект</article>'], diagnostics: [] });
});
it.each(['', '=','A', 'AA=', 'AA===', 'AA+/', 'a b', 'Zh=='])('rejects empty or noncanonical base64url %j', data => {
  const result = decodeMime({ mimeType: 'text/plain', body: { data } });
  expect(result.text).toEqual([]);
  expect(result.diagnostics).toContain(data === '' ? 'empty_body' : 'invalid_base64url');
});
it.each(['Zg', 'Zg=='])('supports valid padded/unpadded base64url %s', data => {
  expect(decodeMime({ mimeType: 'text/plain', body: { data } }).text).toEqual(['f']);
});
it('decodes declared windows-1251 independently of the multipart container charset', () => {
  expect(decodeMime({ mimeType: 'multipart/alternative', headers: [{ name: 'Content-Type', value: 'multipart/alternative; charset=utf-8' }],
    parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="windows-1251"' }],
      body: { data: Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]).toString('base64url') } }] }).text).toEqual(['Привет']);
});
it.each(['x-unknown', 'utf-7'])('rejects unsupported charset %s', charset => {
  expect(decodeMime({ ...leaf('PRIVATE_SENTINEL'), headers: [{ name: 'Content-Type', value: `text/plain; charset=${charset}` }] }))
    .toEqual({ html: [], text: [], diagnostics: ['unsupported_charset', 'empty_body'] });
});
it('rejects invalid UTF-8 bytes without replacement characters', () => {
  expect(decodeMime({ mimeType: 'text/plain', body: { data: '_w' } }).diagnostics).toContain('invalid_text');
});
it('does not parse attached or forwarded subtrees and reports external text storage', () => {
  const result = decodeMime({ mimeType: 'multipart/mixed', parts: [
    { ...leaf('attachment'), filename: 'file.txt' },
    { mimeType: 'message/rfc822', parts: [leaf('forwarded')] },
    { mimeType: 'multipart/mixed', headers: [{ name: 'Content-Disposition', value: 'attachment' }], parts: [leaf('attached')] },
    { mimeType: 'text/plain', body: { attachmentId: 'synthetic-attachment' } }, leaf('inline'),
  ] });
  expect(result.text).toEqual(['inline']);
  expect(result.diagnostics).toContain('attachment_required');
});
it.each([undefined, null, {}, { mimeType: 'text/plain', body: 1 }, { mimeType: 'multipart/mixed', parts: 'bad' }])(
  'handles incomplete payload without an uncaught error: %j', value => {
    const result = decodeMime(value);
    expect(result.text).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
it('rejects aggregate decoded size over 1 MiB, ignoring declared body.size', () => {
  const result = decodeMime({ mimeType: 'multipart/mixed', parts: [leaf('x'.repeat(600_000)), leaf('x'.repeat(600_000))] });
  expect(result).toEqual({ text: [], html: [], diagnostics: ['message_limit'] });
});
it('rejects excessive MIME depth and breadth without partial projects', () => {
  let part: MessagePart = leaf('text');
  for (let i = 0; i < 18; i++) part = { mimeType: 'multipart/mixed', parts: [part] };
  expect(decodeMime(part).diagnostics).toEqual(['mime_limit']);
  expect(decodeMime({ mimeType: 'multipart/mixed', parts: Array.from({ length: 129 }, () => leaf('x')) }).diagnostics).toEqual(['mime_limit']);
});
it('rejects oversized encoded input before decode', () => {
  expect(decodeMime({ mimeType: 'text/plain', body: { data: 'A'.repeat(2_097_153) } }).diagnostics).toEqual(['message_limit']);
});
it('counts unsupported and attached encoded payloads against the message-wide budget', () => {
  expect(decodeMime({mimeType:'multipart/mixed',parts:[leaf('inline'),{mimeType:'application/octet-stream',filename:'synthetic.bin',body:{data:'A'.repeat(2_097_153)}}]}).diagnostics).toEqual(['message_limit']);
});
it.each(['attachment ; filename=file.txt', 'attachment \t;', 'x-unknown', 'attachment ', 'garbage'])('never treats non-inline disposition as content: %s', value => {
    const result = decodeMime({ mimeType: 'multipart/mixed', headers: [{ name: 'Content-Disposition', value }], parts: [leaf('ATTACHMENT_SENTINEL')] });
    expect(result.text).toEqual([]);
  });
it('rejects duplicated Content-Disposition and malformed declared charset', () => {
  expect(decodeMime({ ...leaf('ATTACHMENT_SENTINEL'), headers: [
    { name: 'Content-Disposition', value: 'inline' }, { name: 'Content-Disposition', value: 'attachment' },
  ] }).text).toEqual([]);
  expect(decodeMime({ ...leaf('charset'), headers: [{name:'Content-Type',value:'text/plain; charset="broken'}] }).text).toEqual([]);
});
