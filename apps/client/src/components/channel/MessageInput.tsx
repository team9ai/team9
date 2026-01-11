import { useState, useCallback, useRef, useEffect } from "react";
import { Upload } from "lucide-react";
import { RichTextEditor } from "./editor";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "@/lib/utils";
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

  // Handle paste for images
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            // Create a new file with a proper name
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const extension = file.type.split("/")[1] || "png";
            const namedFile = new File(
              [file],
              `screenshot-${timestamp}.${extension}`,
              {
                type: file.type,
              },
            );
            imageFiles.push(namedFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        // Create a FileList-like object
        const dataTransfer = new DataTransfer();
        imageFiles.forEach((file) => dataTransfer.items.add(file));
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
    <div
      ref={containerRef}
      className={cn(
        "border-t p-4 bg-white relative transition-colors",
        isDragging && "bg-blue-50 border-blue-300",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Upload size={32} />
            <span className="text-sm font-medium">拖放文件到这里上传</span>
          </div>
        </div>
      )}

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
