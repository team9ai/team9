import { useState, useEffect, useRef, memo } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

/**
 * Strip formatting applied by OpenClaw's formatReasoningMessage().
 * Handles "Reasoning:\n" prefix and per-line italic markdown (_text_).
 */
function cleanThinkingContent(raw: string): string {
  let cleaned = raw;
  if (cleaned.startsWith("Reasoning:\n")) {
    cleaned = cleaned.slice("Reasoning:\n".length);
  }
  cleaned = cleaned.replace(/^_(.+)_$/gm, "$1");
  return cleaned.trim();
}

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const prevIsStreaming = useRef(isStreaming);

  // Auto-expand when thinking starts. Don't auto-collapse when thinking
  // pauses (text delta arrives) to avoid flicker if think/text alternate.
  // The block collapses naturally when the streaming component unmounts
  // and the persisted MessageItem renders with isStreaming=false (initial state).
  useEffect(() => {
    if (isStreaming && !prevIsStreaming.current) {
      setIsExpanded(true);
    }
    prevIsStreaming.current = isStreaming;
  }, [isStreaming]);

  if (!content) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} className={isStreaming ? "animate-pulse" : ""} />
        <span>{isStreaming ? "Thinking..." : "Thought process"}</span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 pl-4 border-l-2 border-muted text-sm text-muted-foreground whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              {cleanThinkingContent(content)}
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-muted-foreground/50 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
