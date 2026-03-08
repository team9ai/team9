import type { Message, MessageReaction } from "@/types/im";

// Backend returns aggregated reactions: { emoji, count, userIds[] }
// Frontend expects individual reactions: { id, messageId, userId, emoji, createdAt }
interface AggregatedReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export function normalizeReactions(
  messageId: string,
  reactions: any[],
): MessageReaction[] {
  if (!reactions || reactions.length === 0) return [];
  // Already in individual format (from optimistic updates / WS events)
  if (reactions[0]?.userId && !reactions[0]?.userIds) return reactions;
  // Convert aggregated → individual
  return (reactions as AggregatedReaction[]).flatMap((r) =>
    r.userIds.map((userId) => ({
      id: `${messageId}-${userId}-${r.emoji}`,
      messageId,
      userId,
      emoji: r.emoji,
      createdAt: new Date().toISOString(),
    })),
  );
}

export function normalizeMessage(msg: Message): Message {
  if (!msg.reactions) return msg;
  return { ...msg, reactions: normalizeReactions(msg.id, msg.reactions) };
}

export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map(normalizeMessage);
}
