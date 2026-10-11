import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { MAX_MESSAGE_BYTES, type DecodedBody } from '../gmail/mime.js';
import type { Diagnostic, KworkProject, ParserPolicy, ParseResult } from './model.js';
import { parseBudget } from './budget.js';
import { isUrlPolicy, validateProjectUrl } from './url.js';
export function isParserPolicy(policy: ParserPolicy | undefined): policy is ParserPolicy {
  if (policy?.format === 'kwork-table-v1') return isUrlPolicy(policy.urls) && 'pathname' in policy.urls;
  return !!policy && policy.format === 'synthetic-v1' && typeof policy.htmlBlockSelector === 'string' &&
    policy.htmlBlockSelector.length <= 200 && /^[a-z][a-z0-9-]*(?:\[data-[a-z0-9-]+\])?$/.test(policy.htmlBlockSelector) && isUrlPolicy(policy.urls);
}
/** Owner-confirmed observed template. Caller must still supply a confirmed sender to the reader. */
export const KWORK_TABLE_POLICY: ParserPolicy = { format: 'kwork-table-v1', urls: {
  hostname: 'kwork.ru', pathname: '/new_offer', projectParameter: 'project',
} };

const labels = {
  budget: 'Бюджет', desired: 'Желаемый бюджет', maximum: 'Максимальный бюджет',
  customer: 'Заказчик', rate: 'Нанимает', posted: 'Размещено проектов', hired: 'Нанято проектов',
} as const;
const recognizedLabels = new Set<string>([...Object.values(labels), 'Проект', 'Ссылка']);
function fields(lines: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of lines) {
    const match = /^([^:\r\n]+):\s*([^\r\n]*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      const key = match[1].trim();
      if (!recognizedLabels.has(key)) continue;
      const existing = result.get(key) ?? [];
      // Two occurrences are sufficient to mark ambiguity; never accumulate unbounded email values.
      if (existing.length < 2) existing.push(match[2].trim());
      result.set(key, existing);
    }
  }
  return result;
}
function optionalFields(project: KworkProject, values: Map<string, string[]>, issues: Diagnostic[]): void {
  const one = (label: string): string | undefined => {
    const items = values.get(label);
    if (!items) return undefined;
    if (items.length !== 1 || !items[0]) { issues.push('invalid_optional'); return undefined; }
    return items[0];
  };
  const budget: NonNullable<KworkProject['budget']> = {};
  for (const [label, role] of [[labels.budget, 'unspecified'], [labels.desired, 'desired'], [labels.maximum, 'maximum']] as const) {
    const raw = one(label);
    if (raw !== undefined) {
      const value = parseBudget(raw);
      if (value) budget[role] = value;
      else issues.push('invalid_optional');
    }
  }
  if (Object.keys(budget).length) project.budget = budget;
  const customer = one(labels.customer);
  if (customer !== undefined) {
    // eslint-disable-next-line no-control-regex -- Do not admit control bytes from email data.
    if (customer.length <= 150 && !/[\u0000-\u001f\u007f]/u.test(customer)) project.customerName = customer;
    else issues.push('invalid_optional');
  }
  const rate = one(labels.rate);
  if (rate !== undefined) {
    if (/^\d{1,3}(?:[.,]\d{1,2})?%$/.test(rate) && Number(rate.slice(0, -1).replace(',', '.')) <= 100)
      project.hireRate = Number(rate.slice(0, -1).replace(',', '.'));
    else issues.push('invalid_optional');
  }
  const stats: NonNullable<KworkProject['customerStatistics']> = {};
  for (const [label, key] of [[labels.posted, 'postedProjects'], [labels.hired, 'hiredProjects']] as const) {
    const raw = one(label);
    if (raw !== undefined) {
      const value = Number(raw);
      if (/^\d+$/.test(raw) && Number.isSafeInteger(value)) stats[key] = value;
      else issues.push('invalid_optional');
    }
  }
  if (Object.keys(stats).length) project.customerStatistics = stats;
}
function projectFromBlock(titles: string[], links: string[], values: Map<string, string[]>, source: string,
  policy: ParserPolicy, diagnostics: Diagnostic[]): KworkProject | undefined {
  if (titles.length !== 1 || !titles[0]?.trim() || titles[0].trim().length > 300 ||
      // eslint-disable-next-line no-control-regex -- Reject control bytes in untrusted titles.
      /[\u0000-\u001f\u007f]/u.test(titles[0])) { diagnostics.push('invalid_project'); return undefined; }
  const identities = links.map(link => validateProjectUrl(link, policy.urls));
  if (!identities.length || identities.some(identity => !identity)) { diagnostics.push('invalid_project'); return undefined; }
  if (new Set(identities.map(identity => identity?.projectId)).size !== 1) { diagnostics.push('ambiguous_block'); return undefined; }
  const identity = identities[0]!;
  const project: KworkProject = { ...identity, title: titles[0].trim(), sourceGmailMessageId: source };
  optionalFields(project, values, diagnostics);
  return project;
}
const compactText = (text: string): string => text.replace(/\s+/gu, ' ').trim();
function tableRows(table: HTMLElement): HTMLElement[] {
  return table.children.flatMap(child => child.rawTagName === 'tr' ? [child] :
    ['thead', 'tbody'].includes(child.rawTagName) ? child.children.filter(row => row.rawTagName === 'tr') : []);
}
function rowCells(row: HTMLElement): HTMLElement[] | undefined {
  const cells = row.children;
  if (cells.length !== 3 || cells.some(cell => !['td', 'th'].includes(cell.rawTagName) || cell.querySelector('table') ||
      ['rowspan', 'colspan'].some(name => cell.hasAttribute(name) && cell.getAttribute(name) !== '1'))) return undefined;
  return cells;
}
function boundedStatistic(text: string, caption: RegExp, valuePattern: RegExp, issues: Diagnostic[]): number | undefined {
  // Count captions, not just valid numbers: a malformed second value is still ambiguous.
  const captions = text.matchAll(new RegExp(caption.source, caption.flags + 'g'));
  if (captions.next().done) return undefined;
  if (!captions.next().done) { issues.push('invalid_optional'); return undefined; }
  const line = text.split(/\r?\n/u).map(compactText).find(line => caption.test(line));
  const match = line && valuePattern.exec(line);
  if (!match) { issues.push('invalid_optional'); return undefined; }
  return Number(match[1]!.replace(',', '.'));
}
function tableProjects(root: HTMLElement, source: string, policy: ParserPolicy): ParseResult {
  const result: ParseResult = { projects: [], diagnostics: [] };
  const tables = root.querySelectorAll('table').map(table => ({ table, rows: tableRows(table) })).filter(({rows}) => {
    const cells = rows[0] && rowCells(rows[0]);
    return cells?.map(cell => compactText(cell.text)).join('|') === 'Название|Покупатель|Цена';
  });
  const selected = new Set(tables.map(item => item.table));
  let rowsSeen = 0;
  for (const {table, rows} of tables) {
    let parent = table.parentNode;
    while (parent && !selected.has(parent)) parent = parent.parentNode;
    if (parent) { result.diagnostics.push('ambiguous_block'); continue; }
    for (const row of rows.slice(1)) {
      if (++rowsSeen > 100) return { projects: [], diagnostics: ['html_limit'] };
      const cells = rowCells(row);
      if (!cells) { result.diagnostics.push('ambiguous_block'); continue; }
      const [titleCell, buyerCell, priceCell] = cells as [HTMLElement, HTMLElement, HTMLElement];
      const anchors = titleCell.querySelectorAll('a[href]');
      const project = projectFromBlock([...new Set(anchors.map(a => compactText(a.text)))],
        anchors.map(a => a.getAttribute('href') ?? ''), new Map(), source, policy, result.diagnostics);
      if (!project) continue;
      // Preserve the confirmed below-title text as a whole; don't guess the description/category boundary.
      const titleBranch = titleCell.childNodes.findIndex(node => {
        let parent = anchors[0]?.parentNode;
        if (node === anchors[0]) return true;
        while (parent && parent !== titleCell) { if (parent === node) return true; parent = parent.parentNode; }
        return false;
      });
      if (titleBranch >= 0) {
        const details = compactText(titleCell.childNodes.slice(titleBranch + 1).map(node => node.text).join(' '));
        if (details && details.length <= 4_000) project.details = details;
        else if (details) result.diagnostics.push('invalid_optional');
      }
      const buyerAnchors = buyerCell.querySelectorAll('a[href]').filter(a => compactText(a.text));
      if (buyerAnchors.length === 1) {
        const name = compactText(buyerAnchors[0]!.text);
        // eslint-disable-next-line no-control-regex -- Reject control bytes in untrusted names.
        if (name.length <= 150 && !/[\u0000-\u001f\u007f]/u.test(name)) project.customerName = name;
        else result.diagnostics.push('invalid_optional');
      } else if (buyerAnchors.length > 1) result.diagnostics.push('invalid_optional');
      const statsText = buyerCell.structuredText;
      const count = boundedStatistic(statsText, /проектов на бирже/iu,
        /^(\d{1,16})\s+проектов на бирже$/iu, result.diagnostics);
      if (count !== undefined) {
        if (Number.isSafeInteger(count)) project.customerStatistics = { exchangeProjects: count };
        else result.diagnostics.push('invalid_optional');
      }
      const rate = boundedStatistic(statsText, /нанято/iu,
        /^(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s+нанято$/iu, result.diagnostics);
      if (rate !== undefined) {
        if (rate <= 100) project.hireRate = rate;
        else result.diagnostics.push('invalid_optional');
      }
      const raw = priceCell.text.trim();
      if (raw) {
        const value = parseBudget(raw);
        if (value?.kind === 'fixed') project.price = { raw, currency: value.currency, amount: value.amount };
        else result.diagnostics.push('invalid_optional');
      }
      result.projects.push(project);
    }
  }
  return result;
}
function htmlProjects(html: string, source: string, policy: ParserPolicy): ParseResult {
  const result: ParseResult = { projects: [], diagnostics: [] };
  const root = parseHtml(html, { comment: false, parseNoneClosedTags: true });
  const pending = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 10_000 || item.depth > 64) return { projects: [], diagnostics: ['html_limit'] };
    for (const node of item.node.children) pending.push({ node, depth: item.depth + 1 });
  }
  // No rendering, script execution or resource resolution. Exclude inactive subtrees before extraction.
  for (const element of root.querySelectorAll('script,style,template,noscript,iframe,object,svg,math,[hidden],[aria-hidden="true"]')) element.remove();
  for (const element of root.querySelectorAll('[style]')) {
    const style = element.getAttribute('style') ?? '';
    // Conservative, linear handling of obfuscated CSS; don't implement a browser CSS interpreter.
    if (style.includes('/*') || style.includes('\\') || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) element.remove();
  }
  if (policy.format === 'kwork-table-v1') return tableProjects(root, source, policy);
  const blocks = root.querySelectorAll(policy.htmlBlockSelector);
  if (blocks.length > 100) return { projects: [], diagnostics: ['html_limit'] };
  const selected = new Set(blocks);
  const overlapping = new Set<typeof root>();
  for (const block of blocks) {
    let parent = block.parentNode;
    while (parent) {
      if (selected.has(parent)) { overlapping.add(parent); overlapping.add(block); }
      parent = parent.parentNode;
    }
  }
  for (const block of blocks) {
    if (overlapping.has(block)) { result.diagnostics.push('ambiguous_block'); continue; }
    const headings = block.querySelectorAll('h2');
    const titleAnchors = headings.length === 1 ? headings[0]!.querySelectorAll('a[href]') : [];
    const titles = [...new Set(titleAnchors.map(anchor => anchor.text.trim()))];
    const links = block.querySelectorAll('a[href]').map(link => link.getAttribute('href') ?? '');
    const values = fields(block.querySelectorAll('p').map(p => p.text));
    const project = projectFromBlock(titles, links, values, source, policy, result.diagnostics);
    if (project) result.projects.push(project);
  }
  return result;
}
function textProjects(text: string, source: string, policy: ParserPolicy): ParseResult {
  const result: ParseResult = { projects: [], diagnostics: [] };
  if (policy.format === 'kwork-table-v1') return result; // No observed plain-text template is confirmed.
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).filter(block => block.trim());
  if (blocks.length > 100) return { projects: [], diagnostics: ['html_limit'] };
  for (const block of blocks) {
    const values = fields(block.split('\n'));
    if (!values.has('Проект') && !values.has('Ссылка')) continue;
    const project = projectFromBlock(values.get('Проект') ?? [], values.get('Ссылка') ?? [], values, source, policy, result.diagnostics);
    if (project) result.projects.push(project);
  }
  return result;
}
export function parseProjects(body: DecodedBody, sourceGmailMessageId: string, policy?: ParserPolicy): ParseResult {
  if (!isParserPolicy(policy))
    return { projects: [], diagnostics: ['unconfirmed_policy'] };
  if (body.segments) {
    const result: ParseResult = { projects: [], diagnostics: [...body.diagnostics] };
    let bytes = 0;
    if (body.segments.length > 128) return { projects: [], diagnostics: ['html_limit'] };
    for (const segment of body.segments) {
      for (const content of [...segment.html, ...segment.text]) bytes += Buffer.byteLength(content);
      if (bytes > MAX_MESSAGE_BYTES) return { projects: [], diagnostics: ['html_limit'] };
      const parsed = parseProjects({ ...segment, diagnostics: [] }, sourceGmailMessageId, policy);
      if (parsed.diagnostics.includes('html_limit')) return parsed;
      result.projects.push(...parsed.projects); result.diagnostics.push(...parsed.diagnostics);
    }
    if (result.projects.length > 100) return { projects: [], diagnostics: ['html_limit'] };
    return dedup(result);
  }
  const diagnostics = [...body.diagnostics];
  let best: ParseResult = { projects: [], diagnostics: [] };
  for (const [representations, parse] of [[body.html, htmlProjects], [body.text, textProjects]] as const) {
    for (const content of representations) {
      if (Buffer.byteLength(content) > MAX_MESSAGE_BYTES) return { projects: [], diagnostics: ['html_limit'] };
      let result: ParseResult;
      try { result = parse(content, sourceGmailMessageId, policy); }
      catch { result = { projects: [], diagnostics: ['invalid_payload'] }; }
      if (result.diagnostics.includes('html_limit')) return result;
      diagnostics.push(...result.diagnostics);
      result = dedup(result);
      if (result.projects.length > best.projects.length) best = result;
    }
    if (best.projects.length) break;
  }
  diagnostics.push(...best.diagnostics);
  if (!best.projects.length && !diagnostics.length) diagnostics.push('no_project_blocks');
  return dedup({ projects: best.projects, diagnostics });
}
function dedup(result: ParseResult): ParseResult {
  const seen = new Set<string>();
  const projects = result.projects.filter(project => {
    if (seen.has(project.projectId)) { result.diagnostics.push('duplicate_project'); return false; }
    seen.add(project.projectId); return true;
  });
  return { projects, diagnostics: [...new Set(result.diagnostics)] };
}
