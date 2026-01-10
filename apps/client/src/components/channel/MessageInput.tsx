import { RichTextEditor } from "./editor";
import { useFileUpload } from "@/hooks/useFileUpload";
import type { AttachmentDto } from "@/types/im";

interface MessageInputProps {
  channelId: string;
  onSend: (content: string, attachments?: AttachmentDto[]) => Promise<void>;
  disabled?: boolean;
}

export function MessageInput({
  channelId,
  onSend,
  disabled,
}: MessageInputProps) {
  const {
    uploadingFiles,
    addFiles,
    removeFile,
    retryFile,
    getAttachments,
    isUploading,
    clearFiles,
  } = useFileUpload({
    visibility: "channel",
    channelId,
  });

  const handleSubmit = async (content: string) => {
    // Don't send if uploading or nothing to send
    if (isUploading) return;

    const attachments = getAttachments();
    const hasContent = content.trim().length > 0;
    const hasAttachments = attachments.length > 0;

    if (!hasContent && !hasAttachments) return;
    if (disabled) return;

    await onSend(content, attachments.length > 0 ? attachments : undefined);

    // Clear uploaded files after successful send
    clearFiles();
  };

  const handleFileSelect = (files: FileList) => {
    addFiles(files);
  };

  return (
    <div className="border-t p-4 bg-white">
      <RichTextEditor
        onSubmit={handleSubmit}
        disabled={disabled || isUploading}
        placeholder="Type a message... (Enter to send, Shift+Enter for new line, @ to mention)"
        onFileSelect={handleFileSelect}
        uploadingFiles={uploadingFiles}
        onRemoveFile={removeFile}
        onRetryFile={retryFile}
      />
    </div>
  );
}
