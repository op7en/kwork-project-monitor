import type { KworkProject } from '../kwork/model.js';
import { FILTER_RULES, type FilterRules } from './rules.js';
export type Classification = 'match' | 'review' | 'exclude';
export type FilterReason = 'stack_and_task' | 'small_auxiliary_task' | 'insufficient_evidence' |
  'unwanted_stack' | 'mixed_stack' | 'complex_scope' | 'scope_budget_caution' | 'customer_caution' | 'outside_stack';
export interface FilterDecision { classification: Classification; reasons: FilterReason[] }
export function classifyProject(project: KworkProject, rules: FilterRules = FILTER_RULES): FilterDecision {
  const text = (project.title.slice(0, 300) + '\n' + (project.details ?? '').slice(0, 4000)).normalize('NFKC');
  const has = (patterns: readonly RegExp[]) => patterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(text); });
  const primary = has(rules.primary), auxiliary = has(rules.auxiliary), unwanted = has(rules.unwanted);
  const done = (classification: Classification, ...reasons: FilterReason[]): FilterDecision => ({ classification, reasons });
  if (unwanted) return primary || auxiliary ? done('review', 'mixed_stack') : done('exclude', 'unwanted_stack');
  if (has(rules.ambiguous)) return done('review', 'insufficient_evidence');
  if (has(rules.complex)) return done('review', 'complex_scope',
    ...(project.price?.currency === 'RUB' && Number.isFinite(project.price.amount) && project.price.amount < rules.cautionPrice
      ? ['scope_budget_caution' as const] : []));
  if (has(rules.unrelated)) return primary || auxiliary ? done('review', 'insufficient_evidence') : done('exclude', 'outside_stack');
  if (!has(rules.task) || !primary && !(auxiliary && has(rules.small))) return done('review', 'insufficient_evidence');
  if (project.hireRate !== undefined && Number.isFinite(project.hireRate) && project.hireRate >= 0 &&
      project.hireRate < rules.cautionHireRate &&
      (project.customerStatistics?.exchangeProjects ?? -1) >= rules.cautionCustomerProjects) return done('review', 'customer_caution');
  return done('match', primary ? 'stack_and_task' : 'small_auxiliary_task');
}
