import { expect, it, vi } from 'vitest';
import { decodeMime } from '../src/gmail/mime.js';
import { parseProjects } from '../src/kwork/parser.js';
import { createSmokeStructureDiagnostics } from '../src/smoke/structureDiagnostics.js';
import { selectedIdMatchesCandidateOne } from '../src/smoke/selectionDiagnostics.js';
import { TABLE_HTML, TABLE_POLICY } from './fixtures/kwork-table-v1.js';

const encoded = (value: string) => Buffer.from(value).toString('base64url');

it.each([
  'margin:0; /* email layout comment */ padding:0',
  'font-family:"synthetic\\20 font"; padding:0',
  '--display:none; content:"visibility:hidden"; display:block',
])('retains eight visible email tables when unrelated inline CSS contains %s', style => {
  const stats = createSmokeStructureDiagnostics(true);
  const html = `<div style="${style.replaceAll('"', '&quot;')}">${TABLE_HTML}` +
    '<table><tr><td>synthetic layout</td></tr></table>'.repeat(6) + '</div>';
  const result = parseProjects({ html: [html], text: [], diagnostics: [] },
    'synthetic-message', TABLE_POLICY, stats);
  expect(result.projects).toHaveLength(1);
  expect(stats.html_tables_before_hidden_filter).toBe(8);
  expect(stats.html_tables_after_hidden_filter).toBe(8);
  expect(stats.tables_header_gate_passed).toBe(1);
  expect(stats.html_tables_preserved_legacy_css_comment + stats.html_tables_preserved_legacy_css_escape +
    stats.html_tables_preserved_legacy_css_substring).toBe(8);
});
it('counts MIME parts before decoding, decoded parts, and HTML skips without retaining content', () => {
  const stats = createSmokeStructureDiagnostics(true);
  const decoded = decodeMime({ mimeType: 'multipart/mixed', parts: [
    { mimeType: 'text/html', filename: 'synthetic.html', body: { data: encoded(TABLE_HTML) } },
    { mimeType: 'text/html', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { data: encoded(TABLE_HTML) } },
    { mimeType: 'text/html', body: { data: encoded(TABLE_HTML) } },
    { mimeType: 'text/plain', body: { data: encoded('synthetic text') } },
  ] }, stats);
  expect({
    htmlBefore: stats.html_parts_before_decode,
    plainBefore: stats.plain_parts_before_decode,
    htmlAfter: stats.html_parts_after_decode,
    plainAfter: stats.plain_parts_after_decode,
    filename: stats.html_parts_skipped_filename,
    disposition: stats.html_parts_skipped_content_disposition,
    decodedHtml: decoded.html.length,
    decodedText: decoded.text.length,
  }).toEqual({ htmlBefore: 3, plainBefore: 1, htmlAfter: 1, plainAfter: 1,
    filename: 1, disposition: 1, decodedHtml: 1, decodedText: 1 });
  expect(JSON.stringify(stats)).not.toContain(TABLE_HTML);
});

it('counts tables before and after inactive element filtering, header pass, and extracted projects', () => {
  const stats = createSmokeStructureDiagnostics(false);
  const result = parseProjects({ html: [TABLE_HTML.replace('</body>',
    '<table hidden><tr><td>inactive</td></tr></table></body>')], text: [], diagnostics: [] },
  'synthetic-message', TABLE_POLICY, stats);
  expect({ before: stats.html_tables_before_hidden_filter, after: stats.html_tables_after_hidden_filter,
    passed: stats.tables_header_gate_passed, projects: stats.extracted_projects, result: result.projects.length })
    .toEqual({ before: 3, after: 2, passed: 1, projects: 1, result: 1 });
});

it.each([
  ['cell_count', '<table><tr><td>Название</td><td>Покупатель</td></tr></table>'],
  ['nested_table', '<table><tr><td><table><tr><td>Название</td></tr></table></td><td>Покупатель</td><td>Цена</td></tr></table>'],
  ['span', '<table><tr><td colspan="2">Название</td><td>Покупатель</td><td>Цена</td></tr></table>'],
  ['header_mismatch', '<table><tr><td>Проект</td><td>Покупатель</td><td>Цена</td></tr></table>'],
] as const)('counts header-gate rejection: %s', (reason, html) => {
  const stats = createSmokeStructureDiagnostics(false);
  parseProjects({ html: [html], text: [], diagnostics: [] }, 'synthetic-message', TABLE_POLICY, stats);
  expect(stats[`header_reject_${reason}`]).toBe(1);
  expect(stats.tables_header_gate_passed).toBe(0);
});

it('matches candidate one only for a unique mapping entry and never returns the private mapping ID', () => {
  const selected = 'synthetic-selected-message';
  const mapping = { candidates: [
    { number: 1, id: selected, internalDate: '1791659280000' },
    { number: 2, id: 'synthetic-other-message', internalDate: '1791659000000' },
  ] };
  expect(selectedIdMatchesCandidateOne(selected, mapping)).toBe(true);
  expect(selectedIdMatchesCandidateOne('synthetic-different-message', mapping)).toBe(false);
  expect(selectedIdMatchesCandidateOne(selected, { candidates: [mapping.candidates[0], mapping.candidates[0]] })).toBe(false);
  expect(JSON.stringify(selectedIdMatchesCandidateOne(selected, mapping))).not.toContain(selected);
});

it('does not print content through the smoke structural diagnostic formatter', async () => {
  const stats = createSmokeStructureDiagnostics(false);
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const { printSmokeStructureDiagnostics } = await import('../src/smoke/structureDiagnostics.js');
    printSmokeStructureDiagnostics(stats);
    const output = String(consoleInfo.mock.calls[0]?.[0]);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toEqual(stats);
    expect(Object.values(parsed).every(value => typeof value === 'boolean' || typeof value === 'number')).toBe(true);
    expect(output).not.toMatch(/synthetic|https?:|[\w.+-]+@[\w.-]+/i);
  } finally { consoleInfo.mockRestore(); }
});
