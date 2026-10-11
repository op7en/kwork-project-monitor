import type { Context } from 'grammy';

export type OwnerChatContext = Pick<Context, 'from' | 'chat'>;

/** Only genuine Telegram update contexts may be used to confirm a destination. */
export function isOwnerPrivateChat(ctx: OwnerChatContext, ownerId: number): boolean {
  return Number.isSafeInteger(ownerId) && ownerId > 0 && ctx.from?.id === ownerId &&
    !ctx.from.is_bot && ctx.chat?.type === 'private' && ctx.chat.id === ownerId;
}
