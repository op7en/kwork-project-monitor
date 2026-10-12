import type { GmailProjectReader } from './client.js';
export interface HistoryPage {
  historyId: string;
  nextPageToken?: string;
  records: { historyId: string; messageIds: string[] }[];
}
export interface MonitoringGmail {
  currentHistoryId(): Promise<string>;
  historyPage(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
  reader: GmailProjectReader;
}
