import type { InlineKeyboardMarkup } from 'grammy/types';
import type { BudgetValue, KworkProject } from '../kwork/model.js';
import type { FilterDecision, FilterReason } from '../filters/projectFilter.js';
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

const reasonLabels: Record<FilterReason, string> = {
  stack_and_task: 'Подходящий стек и задача', small_auxiliary_task: 'Небольшая вспомогательная задача',
  insufficient_evidence: 'Недостаточно данных', unwanted_stack: 'Нежелательный стек', mixed_stack: 'Смешанный стек',
  complex_scope: 'Сложный объём работ', scope_budget_caution: 'Низкий бюджет для объёма работ',
  customer_caution: 'Низкая доля найма у заказчика', outside_stack: 'Вне основного стека',
};
function displayPrice(price: BudgetValue): string | undefined {
  if (price.currency !== 'RUB') return undefined;
  switch (price.kind) {
    case 'fixed': return validCount(price.amount) ? `${displayCount(price.amount)} ₽` : undefined;
    case 'up-to': return validCount(price.max) ? `до ${displayCount(price.max)} ₽` : undefined;
    case 'from': return validCount(price.min) ? `от ${displayCount(price.min)} ₽` : undefined;
    case 'range': return validCount(price.min) && validCount(price.max) && price.min <= price.max
      ? `${displayCount(price.min)}–${displayCount(price.max)} ₽` : undefined;
  }
}

export function formatProjectNotification(project: KworkProject, decision?: FilterDecision): ProjectNotification | undefined {
  const identity = validateProjectUrl(project.url, KWORK_TABLE_POLICY.urls);
  if (!identity || identity.projectId !== project.projectId) return undefined;
  const title = cleanText(project.title, 300, true);
  if (!title) return undefined;

  const lines = ['Новый проект Kwork'];
  if (decision?.classification === 'review') {
    const reasons = [...new Set(decision.reasons)].map(reason => reasonLabels[reason]).filter(Boolean);
    lines.push(`Статус: На проверку (${reasons.join('; ') || 'Недостаточно данных'})`);
  }
  lines.push(`Название: ${title}`);
  const price = project.price && displayPrice(project.price);
  if (price !== undefined) lines.push(`Цена: ${price}`);
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
