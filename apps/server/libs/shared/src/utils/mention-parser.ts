export interface ParsedMention {
  type: 'user' | 'channel' | 'everyone' | 'here';
  userId?: string;
  channelId?: string;
  originalText: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Parse @mentions from message content
 * Supports two formats:
 *
 * Plain text format:
 * - @everyone - mentions all channel members
 * - @here - mentions all online channel members
 * - @<userId> - mentions a specific user by ID
 * - #<channelId> - mentions a specific channel by ID
 *
 * HTML format (from rich text editor):
 * - <mention data-user-id="userId">...</mention> - mentions a specific user
 */
export function parseMentions(content: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  let match: RegExpExecArray | null;

  // Match @everyone
  const everyoneRegex = /@everyone/gi;
  while ((match = everyoneRegex.exec(content)) !== null) {
    mentions.push({
      type: 'everyone',
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // Match @here
  const hereRegex = /@here/gi;
  while ((match = hereRegex.exec(content)) !== null) {
    mentions.push({
      type: 'here',
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // Match @<uuid> format for user mentions (plain text format)
  const userIdRegex =
    /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
  while ((match = userIdRegex.exec(content)) !== null) {
    mentions.push({
      type: 'user',
      userId: match[1],
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // Match <mention data-user-id="uuid">...</mention> format (HTML format from rich text editor)
  const htmlMentionRegex =
    /<mention\s+data-user-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^>]*>.*?<\/mention>/gi;
  while ((match = htmlMentionRegex.exec(content)) !== null) {
    mentions.push({
      type: 'user',
      userId: match[1],
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  // Match #<uuid> format for channel mentions
  const channelIdRegex =
    /#<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
  while ((match = channelIdRegex.exec(content)) !== null) {
    mentions.push({
      type: 'channel',
      channelId: match[1],
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return mentions;
}

/**
 * Extract unique user IDs from mentions
 */
export function extractMentionedUserIds(mentions: ParsedMention[]): string[] {
  const userIds = new Set<string>();

  for (const mention of mentions) {
    if (mention.type === 'user' && mention.userId) {
      userIds.add(mention.userId);
    }
  }

  return Array.from(userIds);
}

/**
 * Check if @everyone or @here is mentioned
 */
export function hasBroadcastMention(mentions: ParsedMention[]): {
  everyone: boolean;
  here: boolean;
} {
  return {
    everyone: mentions.some((m) => m.type === 'everyone'),
    here: mentions.some((m) => m.type === 'here'),
  };
}
