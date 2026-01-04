import { RichTextEditor } from "./editor";

interface MessageInputProps {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const handleSubmit = async (content: string) => {
    if (!content.trim() || disabled) return;
    await onSend(content);
  };

  return (
    <div className="border-t p-4 bg-white">
      <RichTextEditor
        onSubmit={handleSubmit}
        disabled={disabled}
        placeholder="Type a message... (Enter to send, Shift+Enter for new line, @ to mention)"
      />
    </div>
  );
}
