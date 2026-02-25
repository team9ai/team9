import { memo } from "react";
import { motion } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageContent } from "./MessageContent";
import { ThinkingBlock } from "./ThinkingBlock";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import type { ChannelMember } from "@/types/im";

interface StreamingMessageItemProps {
  stream: StreamingMessage;
  members: ChannelMember[];
}

export const StreamingMessageItem = memo(function StreamingMessageItem({
  stream,
  members,
}: StreamingMessageItemProps) {
  const botMember = members.find((m) => m.userId === stream.senderId);
  const botUser = botMember?.user;
  const botName = botUser?.displayName || botUser?.username || "Bot";
  const initials = botName[0] || "B";

  return (
    <motion.div
      className="flex gap-3 px-2 py-1"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <Avatar className="shrink-0 w-9 h-9">
        {botUser?.avatarUrl ? (
          <AvatarImage src={botUser.avatarUrl} alt={botName} />
        ) : (
          <AvatarImage src="/bot.webp" alt={botName} />
        )}
        <AvatarFallback className="bg-primary text-primary-foreground text-sm">
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col items-start flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{botName}</span>
          <span className="text-xs text-muted-foreground">streaming...</span>
        </div>

        {/* Thinking block (collapsible) */}
        {stream.thinking && (
          <ThinkingBlock
            content={stream.thinking}
            isStreaming={stream.isThinking}
          />
        )}

        {/* Streaming text content */}
        {stream.content ? (
          <div className="w-fit max-w-full">
            <MessageContent
              content={stream.content}
              className="text-sm whitespace-pre-wrap break-words"
            />
            {/* Blinking cursor when streaming text (not thinking) */}
            {stream.isStreaming && !stream.isThinking && (
              <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ) : stream.isThinking ? null : (
          /* Show dots only when no content and not thinking yet */
          <div className="flex gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-[5px] h-[5px] rounded-full bg-primary animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
});
