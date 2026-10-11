import type { InlineKeyboardMarkup } from 'grammy/types';
import type { KworkProject } from '../kwork/model.js';
import { KWORK_TABLE_POLICY } from '../kwork/parser.js';
import { validateProjectUrl } from '../kwork/url.js';

export interface ProjectNotification {
  text: string;
  options: {
    reply_markup: InlineKeyboardMarkup;
    link_preview_options: { is_disabled: true };
  };
}

function cleanText(value: string, limit: number, singleLine = false): string {
  // Bound work before normalizing untrusted text; never cut a UTF-16 surrogate pair.
  const truncated = value.length > limit;
  let text = value.slice(0, limit).replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- Remove control/bidi characters from email-derived display text.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '');
  if (singleLine) text = text.replace(/\s+/gu, ' ');
  text = text.trim().slice(0, truncated ? limit - 1 : limit);
  if (!text) return '';
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text + (truncated ? '…' : '');
}

const validCount = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0;
const displayCount = (value: number): string => new Intl.NumberFormat('ru-RU').format(value).replace(/[\u00a0\u202f]/g, ' ');

export function formatProjectNotification(project: KworkProject): ProjectNotification | undefined {
  const identity = validateProjectUrl(project.url, KWORK_TABLE_POLICY.urls);
  if (!identity || identity.projectId !== project.projectId) return undefined;
  const title = cleanText(project.title, 300, true);
  if (!title) return undefined;

  const lines = ['Новый проект Kwork', `Название: ${title}`];
  if (project.price?.currency === 'RUB' && validCount(project.price.amount))
    lines.push(`Цена: ${displayCount(project.price.amount)} ₽`);
  const customer = project.customerName && cleanText(project.customerName, 150, true);
  if (customer) lines.push(`Покупатель: ${customer}`);
  const stats = project.customerStatistics;
  if (validCount(stats?.exchangeProjects)) lines.push(`Проектов на бирже: ${displayCount(stats.exchangeProjects)}`);
  if (project.hireRate !== undefined && Number.isFinite(project.hireRate) && project.hireRate >= 0 && project.hireRate <= 100)
    lines.push(`Нанято: ${String(project.hireRate).replace('.', ',')}%`);
  if (validCount(stats?.postedProjects)) lines.push(`Размещено проектов: ${displayCount(stats.postedProjects)}`);
  if (validCount(stats?.hiredProjects)) lines.push(`Нанято проектов: ${displayCount(stats.hiredProjects)}`);

  let text = lines.join('\n');
  if (project.details) {
    const prefix = '\n\nОписание:\n';
    const details = cleanText(project.details, 4000 - text.length - prefix.length);
    if (details) text += prefix + details;
  }
  return { text, options: {
    reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', url: identity.url }]] },
    link_preview_options: { is_disabled: true },
  } };
}
