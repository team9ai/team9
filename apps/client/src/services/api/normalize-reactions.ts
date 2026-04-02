import type { Message, MessageReaction } from "@/types/im";

// Backend returns aggregated reactions: { emoji, count, userIds[] }
// Frontend expects individual reactions: { id, messageId, userId, emoji, createdAt }
interface AggregatedReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

function isAggregatedReaction(
  reaction: MessageReaction | AggregatedReaction,
): reaction is AggregatedReaction {
  return "userIds" in reaction;
}

export function normalizeReactions(
  messageId: string,
  reactions: Array<MessageReaction | AggregatedReaction>,
): MessageReaction[] {
  if (!reactions || reactions.length === 0) return [];
  // Already in individual format (from optimistic updates / WS events)
  if (
    reactions.every(
      (reaction): reaction is MessageReaction =>
        !isAggregatedReaction(reaction),
    )
  ) {
    return reactions;
  }
  // Convert aggregated → individual
  return reactions.flatMap((reaction) =>
    isAggregatedReaction(reaction)
      ? reaction.userIds.map((userId) => ({
          id: `${messageId}-${userId}-${reaction.emoji}`,
          messageId,
          userId,
          emoji: reaction.emoji,
          createdAt: new Date().toISOString(),
        }))
      : [reaction],
  );
}

export function normalizeMessage(msg: Message): Message {
  if (!msg.reactions) return msg;
  return { ...msg, reactions: normalizeReactions(msg.id, msg.reactions) };
}

export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map(normalizeMessage);
}
