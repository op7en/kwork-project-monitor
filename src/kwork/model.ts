export type BudgetValue = { raw: string; currency: 'RUB' } & (
  | { kind: 'fixed'; amount: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'up-to'; max: number }
  | { kind: 'from'; min: number }
);
export interface KworkProject {
  projectId: string;
  title: string;
  url: string;
  sourceGmailMessageId: string;
  budget?: { unspecified?: BudgetValue; desired?: BudgetValue; maximum?: BudgetValue };
  /** Price displayed in the notification; no desired/maximum-budget meaning is inferred. */
  price?: { raw: string; currency: 'RUB'; amount: number };
  /** Text below the linked title, including category text where it is not separately labelled. */
  details?: string;
  customerName?: string;
  hireRate?: number;
  customerStatistics?: { postedProjects?: number; hiredProjects?: number; exchangeProjects?: number };
}
export type Diagnostic = 'invalid_payload' | 'empty_body' | 'attachment_required' |
  'unsupported_mime' | 'invalid_base64url' | 'unsupported_charset' | 'invalid_text' |
  'message_limit' | 'mime_limit' | 'unconfirmed_policy' | 'html_limit' |
  'no_project_blocks' | 'ambiguous_block' | 'invalid_project' | 'invalid_optional' |
  'duplicate_project' | 'message_rejected' | 'message_read_failed' | 'batch_limit' | 'historical_message' | 'operation_cancelled';
export interface ParseResult { projects: KworkProject[]; diagnostics: Diagnostic[] }
export type UrlPolicy = { hostname: string; pathPrefix: string } |
  { hostname: 'kwork.ru'; pathname: '/new_offer'; projectParameter: 'project' };
export type ParserPolicy = {
  /** Trusted configuration, never extracted from email content. No production default. */
  format: 'synthetic-v1';
  htmlBlockSelector: string;
  urls: { hostname: string; pathPrefix: string };
} | { format: 'kwork-table-v1'; urls: { hostname: 'kwork.ru'; pathname: '/new_offer'; projectParameter: 'project' } };
