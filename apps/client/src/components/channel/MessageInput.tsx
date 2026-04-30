import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RichTextEditor } from "./editor";
import type { EditorSubmitPayload } from "./editor/utils/submitEditorContent";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";
import type { AttachmentDto } from "@/types/im";
import type { useBotModelSwitch } from "@/hooks/useBotModelSwitch";

interface MessageInputProps {
  /** Channel ID for file upload context (optional in compact mode) */
  channelId?: string;
  onSend: (
    payload: EditorSubmitPayload,
    attachments?: AttachmentDto[],
  ) => Promise<void>;
  disabled?: boolean;
  /** Compact mode for thread panel - smaller height, no drag-drop */
  compact?: boolean;
  /** Reply indicator for thread */
  replyingTo?: {
    messageId: string;
    senderName: string;
  } | null;
  /** Callback to clear reply indicator */
  onClearReplyingTo?: () => void;
  /** Placeholder text override */
  placeholder?: string;
  /** Draft text to pre-fill in the editor */
  initialDraft?: string;
  /** Automatically send the initial draft once after mount */
  autoSendInitialDraft?: boolean;
  /** Called after the initial draft auto-send succeeds */
  onInitialDraftAutoSent?: () => void;
  /** Whether this is a bot DM channel - shows AI feature buttons */
  isBotDm?: boolean;
  /** Bot model switching info */
  botModelSwitch?: ReturnType<typeof useBotModelSwitch>;
}

export function MessageInput({
  channelId,
  onSend,
  disabled,
  compact = false,
  replyingTo,
  onClearReplyingTo,
  placeholder,
  initialDraft,
  autoSendInitialDraft,
  onInitialDraftAutoSent,
  isBotDm = false,
  botModelSwitch,
}: MessageInputProps) {
  const { t } = useTranslation(["message", "thread"]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Handle drag enter
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        addFiles(files);
      }
    },
    [addFiles],
  );

  // Handle paste for files (images, documents, etc.)
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            // Pasted screenshots often lack a meaningful name — generate one
            if (!file.name || file.name.trim().length === 0) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
              const extension = file.type.split("/")[1] || "bin";
              pastedFiles.push(
                new File([file], `pasted-${timestamp}.${extension}`, {
                  type: file.type,
                }),
              );
            } else {
              pastedFiles.push(file);
            }
          }
        }
      }

      if (pastedFiles.length > 0) {
        const dataTransfer = new DataTransfer();
        pastedFiles.forEach((file) => dataTransfer.items.add(file));
        addFiles(dataTransfer.files);
      }
    },
    [addFiles],
  );

  // Add paste event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("paste", handlePaste);
    return () => {
      container.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);

  const handleSubmit = async (payload: EditorSubmitPayload) => {
    // Don't send if uploading or nothing to send
    if (isUploading) return;

    const attachments = getAttachments();
    const hasContent = payload.content.trim().length > 0;
    const hasAttachments = attachments.length > 0;

    if (!hasContent && !hasAttachments) return;
    if (disabled) return;

    await onSend(payload, attachments.length > 0 ? attachments : undefined);

    // Clear uploaded files after successful send
    clearFiles();
  };

  const handleFileSelect = (files: FileList) => {
    addFiles(files);
  };

  const defaultPlaceholder = compact
    ? t("thread:inputPlaceholder")
    : "Type a message... (Enter to send, Shift+Enter / Ctrl+Enter for new line, @ to mention)";
  const effectivePlaceholder = placeholder || defaultPlaceholder;

  // Compact mode: simpler layout, still supports file upload via toolbar/paste
  if (compact) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "border-t p-3 bg-background relative transition-colors rounded-b-2xl",
          isDragging && "bg-info/10 border-info/30",
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-info/10 border-2 border-dashed border-info/40 rounded-lg flex items-center justify-center z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-info">
              <Upload size={24} />
              <span className="text-xs font-medium">
                {t("message:dragToUpload")}
              </span>
            </div>
          </div>
        )}

        {/* Replying-to indicator */}
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-muted rounded text-sm">
            <span className="text-muted-foreground">
              {t("thread:replyingTo")}
            </span>
            <span className="font-medium">@{replyingTo.senderName}</span>
            <button
              onClick={onClearReplyingTo}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <RichTextEditor
          channelId={channelId}
          onSubmit={handleSubmit}
          disabled={disabled}
          isUploading={isUploading}
          placeholder={effectivePlaceholder}
          compact
          onFileSelect={handleFileSelect}
          uploadingFiles={uploadingFiles}
          onRemoveFile={removeFile}
          onRetryFile={retryFile}
          initialDraft={initialDraft}
          autoSendInitialDraft={autoSendInitialDraft}
          onInitialDraftAutoSent={onInitialDraftAutoSent}
        />
      </div>
    );
  }

  // Full mode: with drag-drop and file upload support
  return (
    <div
      ref={containerRef}
      className={cn(
        "px-4 pb-4 pt-2 bg-background relative transition-colors w-full max-w-5xl",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className={cn(
          "relative rounded-2xl border border-border bg-card shadow-md transition-shadow focus-within:shadow-lg",
          isDragging && "bg-info/5 border-info/30 shadow-md",
        )}
      >
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-info/10 border-2 border-dashed border-info/40 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-info">
              <Upload size={32} />
              <span className="text-sm font-medium">
                {t("message:dragToUpload")}
              </span>
            </div>
          </div>
        )}

        <RichTextEditor
          channelId={channelId}
          onSubmit={handleSubmit}
          disabled={disabled}
          isUploading={isUploading}
          placeholder={effectivePlaceholder}
          onFileSelect={handleFileSelect}
          uploadingFiles={uploadingFiles}
          onRemoveFile={removeFile}
          onRetryFile={retryFile}
          initialDraft={initialDraft}
          autoSendInitialDraft={autoSendInitialDraft}
          onInitialDraftAutoSent={onInitialDraftAutoSent}
          isBotDm={isBotDm}
          botModelSwitch={botModelSwitch}
        />
      </div>
    </div>
  );
}
