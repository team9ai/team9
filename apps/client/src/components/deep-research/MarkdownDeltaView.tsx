import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownDeltaViewProps {
  markdown: string;
}

export const MarkdownDeltaView = memo(function MarkdownDeltaView({
  markdown,
}: MarkdownDeltaViewProps) {
  if (!markdown) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
});
