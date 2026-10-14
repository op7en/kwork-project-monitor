import type { Api } from 'grammy';
import type { KworkProject } from '../kwork/model.js';
import type { FilterDecision } from '../filters/projectFilter.js';
import { isOwnerPrivateChat, type OwnerChatContext } from './privateChat.js';
import { formatProjectNotification } from './projectFormatter.js';

export type NotificationResult = { status: 'sent' | 'destination_unconfirmed' | 'invalid_project' | 'telegram_error' };

/** Destination is trusted only after a private owner update or validated persisted opt-in. */
export function createProjectNotifier(api: Pick<Api, 'sendMessage'>, ownerId: number) {
  let confirmed = false;
  return {
    hasConfirmedDestination(): boolean { return confirmed; },
    // Trusted runtime only, after checking the ledger binding, baseline and persisted owner opt-in.
    restoreConfirmedDestination(): void { confirmed = true; },
    async sendAlert(text: string): Promise<boolean> {
      if (!confirmed) return false;
      try { await api.sendMessage(ownerId, text); return true; }
      catch { return false; } // No recursive alert or raw Telegram error.
    },
    // Caller must pass a genuine Telegram context; never reconstruct it from mail or arbitrary input.
    confirmDestination(ctx: OwnerChatContext): boolean {
      if (!isOwnerPrivateChat(ctx, ownerId)) return false;
      confirmed = true;
      return true;
    },
    async send(project: KworkProject, decision?: FilterDecision): Promise<NotificationResult> {
      if (!confirmed) return { status: 'destination_unconfirmed' };
      const notification = formatProjectNotification(project, decision);
      if (!notification) return { status: 'invalid_project' };
      try {
        // Destination is the configured owner ID; a caller cannot supply a group chat ID.
        await api.sendMessage(ownerId, notification.text, notification.options);
        return { status: 'sent' };
      } catch {
        // API errors may include tokens and message content. Don't log or return the raw error.
        return { status: 'telegram_error' };
      }
    },
  };
}
