import { useState, useEffect } from "react";
import {
  File,
  FileText,
  Image as ImageIcon,
  Download,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileApi } from "@/services/api/file";
import type { MessageAttachment } from "@/types/im";

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  isOwnMessage?: boolean;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return ImageIcon;
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("pdf") ||
    mimeType.includes("document")
  ) {
    return FileText;
  }
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function ImageAttachment({
  attachment,
  isOwnMessage,
}: {
  attachment: MessageAttachment;
  isOwnMessage?: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadImage = async () => {
    if (imageUrl) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fileApi.getDownloadUrl(attachment.fileKey);
      setImageUrl(result.url);
    } catch (err) {
      setError("Failed to load image");
      console.error("Failed to load image:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-load image when component mounts
  useEffect(() => {
    loadImage();
  }, []);

  if (isLoading) {
    return (
      <div
        className={cn(
          "rounded-lg overflow-hidden flex items-center justify-center",
          isOwnMessage ? "bg-purple-500" : "bg-slate-200",
        )}
        style={{
          width: Math.min(attachment.width || 200, 300),
          height: Math.min(attachment.height || 150, 200),
        }}
      >
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div
        className={cn(
          "rounded-lg p-4 flex flex-col items-center gap-2",
          isOwnMessage ? "bg-purple-500" : "bg-slate-200",
        )}
      >
        <ImageIcon className="w-8 h-8 text-slate-400" />
        <span className="text-xs text-slate-500">
          {error || "Image not available"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={loadImage}
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <a
      href={imageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
    >
      <img
        src={imageUrl}
        alt={attachment.fileName}
        className="max-w-[300px] max-h-[200px] object-contain"
        style={{
          width: attachment.width ? Math.min(attachment.width, 300) : "auto",
          height: attachment.height ? Math.min(attachment.height, 200) : "auto",
        }}
      />
    </a>
  );
}

function FileAttachment({
  attachment,
  isOwnMessage,
}: {
  attachment: MessageAttachment;
  isOwnMessage?: boolean;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const FileIcon = getFileIcon(attachment.mimeType);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const result = await fileApi.getDownloadUrl(attachment.fileKey);
      // Open in new tab or trigger download
      window.open(result.url, "_blank");
    } catch (err) {
      console.error("Failed to get download URL:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg min-w-[200px] max-w-[280px]",
        isOwnMessage
          ? "bg-purple-500/20 border border-purple-400/30"
          : "bg-slate-100 border border-slate-200",
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded flex items-center justify-center flex-shrink-0",
          isOwnMessage ? "bg-purple-400/30" : "bg-slate-200",
        )}
      >
        <FileIcon
          className={cn(
            "w-5 h-5",
            isOwnMessage ? "text-white" : "text-slate-600",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            isOwnMessage ? "text-white" : "text-slate-900",
          )}
          title={attachment.fileName}
        >
          {attachment.fileName}
        </p>
        <p
          className={cn(
            "text-xs",
            isOwnMessage ? "text-purple-200" : "text-slate-500",
          )}
        >
          {formatFileSize(attachment.fileSize)}
        </p>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleDownload}
        disabled={isDownloading}
        className={cn(
          "h-8 w-8 p-0 flex-shrink-0",
          isOwnMessage
            ? "hover:bg-purple-400/30 text-white"
            : "hover:bg-slate-200 text-slate-600",
        )}
        title="Download"
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

export function MessageAttachments({
  attachments,
  isOwnMessage,
}: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null;

  const imageAttachments = attachments.filter((a) =>
    a.mimeType.startsWith("image/"),
  );
  const fileAttachments = attachments.filter(
    (a) => !a.mimeType.startsWith("image/"),
  );

  return (
    <div className="mt-2 space-y-2">
      {/* Image attachments */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageAttachments.map((attachment) => (
            <ImageAttachment
              key={attachment.id}
              attachment={attachment}
              isOwnMessage={isOwnMessage}
            />
          ))}
        </div>
      )}

      {/* File attachments */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((attachment) => (
            <FileAttachment
              key={attachment.id}
              attachment={attachment}
              isOwnMessage={isOwnMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageAttachments;
