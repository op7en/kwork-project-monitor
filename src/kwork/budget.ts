import type { BudgetValue } from './model.js';
const number = '(?:0|[1-9]\\d*|[1-9]\\d{0,2}(?:[ \\u00a0\\u202f]\\d{3})+)';
const amountPattern = new RegExp(`^(?:(до|от)\\s+)?(${number})(?:\\s*[-–—]\\s*(${number}))?\\s*(?:₽|руб\\.?|RUB)$`, 'i');
export function parseBudget(raw: string): BudgetValue | undefined {
  if (raw.length > 120) return undefined;
  const match = amountPattern.exec(raw);
  if (!match) return undefined;
  const first = Number(match[2]?.replace(/[ \u00a0\u202f]/g, ''));
  if (!Number.isSafeInteger(first)) return undefined;
  const common = { raw, currency: 'RUB' as const };
  if (match[3] !== undefined) {
    const second = Number(match[3].replace(/[ \u00a0\u202f]/g, ''));
    if (match[1] || !Number.isSafeInteger(second) || second < first) return undefined;
    return { ...common, kind: 'range', min: first, max: second };
  }
  if (match[1]?.toLowerCase() === 'до') return { ...common, kind: 'up-to', max: first };
  if (match[1]?.toLowerCase() === 'от') return { ...common, kind: 'from', min: first };
  return { ...common, kind: 'fixed', amount: first };
}
