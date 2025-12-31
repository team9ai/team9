import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bold, Italic, List } from "lucide-react";

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || disabled) return;

    try {
      await onSend(content);
      setContent("");
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="border-t p-4">
      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 mb-2">
          <Button type="button" variant="ghost" size="sm">
            <Bold size={16} />
          </Button>
          <Button type="button" variant="ghost" size="sm">
            <Italic size={16} />
          </Button>
          <Button type="button" variant="ghost" size="sm">
            <List size={16} />
          </Button>
        </div>

        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            className="min-h-[80px] resize-none"
            disabled={disabled}
          />
          <Button
            type="submit"
            disabled={!content.trim() || disabled}
            className="bg-purple-600 hover:bg-purple-700"
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
