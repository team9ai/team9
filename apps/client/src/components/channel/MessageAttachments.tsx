import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { VideoAttachment } from "./VideoAttachment";

// Signed download URLs expire after 8h (see file.service.ts).
// Cache for 7h so remounted image rows reuse the same URL and hit the
// browser HTTP cache instead of re-fetching on every virtualized row mount.
const DOWNLOAD_URL_STALE_TIME = 7 * 60 * 60 * 1000;

function useFileDownloadUrl(fileKey: string | null) {
  return useQuery({
    // External pass-through attachments (fileKey === null) have no key to
    // presign — disable the query and let callers fall back to fileUrl.
    enabled: fileKey !== null,
    queryKey: ["file-download-url", fileKey],
    queryFn: () => fileApi.getDownloadUrl(fileKey as string),
    staleTime: DOWNLOAD_URL_STALE_TIME,
    gcTime: DOWNLOAD_URL_STALE_TIME,
  });
}

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

// Reserve a stable box for image attachments so the loading skeleton, the
// final <img>, and the error fallback all occupy the same height. Without
// this the message row resizes after the image decodes, which invalidates
// react-virtuoso's size cache and can leave the viewport parked over a
// blank region during scrolling.
const IMAGE_MAX_WIDTH = 300;
const IMAGE_MAX_HEIGHT = 200;
const IMAGE_FALLBACK_WIDTH = 200;
const IMAGE_FALLBACK_HEIGHT = 150;

function getImageBox(attachment: MessageAttachment): {
  width: number;
  height: number;
} {
  if (attachment.width && attachment.height) {
    const scale = Math.min(
      IMAGE_MAX_WIDTH / attachment.width,
      IMAGE_MAX_HEIGHT / attachment.height,
      1,
    );
    return {
      width: Math.round(attachment.width * scale),
      height: Math.round(attachment.height * scale),
    };
  }
  return { width: IMAGE_FALLBACK_WIDTH, height: IMAGE_FALLBACK_HEIGHT };
}

function ImageAttachment({
  attachment,
  isOwnMessage,
}: {
  attachment: MessageAttachment;
  isOwnMessage?: boolean;
}) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { data, isLoading, error, refetch } = useFileDownloadUrl(
    attachment.fileKey,
  );
  // External attachments resolve via fileUrl directly (no presign needed).
  const imageUrl =
    attachment.fileKey === null ? attachment.fileUrl : (data?.url ?? null);
  const box = getImageBox(attachment);

  if (isLoading && !imageUrl) {
    return (
      <div
        className={cn(
          "rounded-lg overflow-hidden flex items-center justify-center",
          isOwnMessage ? "bg-primary" : "bg-muted",
        )}
        style={{ width: box.width, height: box.height }}
      >
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div
        className={cn(
          "rounded-lg p-4 flex flex-col items-center justify-center gap-2",
          isOwnMessage ? "bg-primary" : "bg-muted",
        )}
        style={{ width: box.width, height: box.height }}
      >
        <ImageIcon className="w-8 h-8 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {error ? "Failed to load image" : "Image not available"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refetch()}
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsPreviewOpen(true)}
        className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity cursor-zoom-in"
        style={{ width: box.width, height: box.height }}
      >
        <img
          src={imageUrl}
          alt={attachment.fileName}
          width={box.width}
          height={box.height}
          className="object-contain"
          style={{ width: box.width, height: box.height }}
        />
      </button>
      {isPreviewOpen && (
        <ImagePreviewDialog
          src={imageUrl}
          alt={attachment.fileName}
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
        />
      )}
    </>
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
      // External attachments are already at a stable URL — open it directly
      // instead of round-tripping through the presign endpoint.
      if (attachment.fileKey === null) {
        window.open(attachment.fileUrl, "_blank");
        return;
      }
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
          ? "bg-primary/20 border border-accent/30"
          : "bg-muted border border-border",
      )}
    >
      <div
        className={cn(
          "w-10 h-10 rounded flex items-center justify-center flex-shrink-0",
          isOwnMessage ? "bg-accent/30" : "bg-muted",
        )}
      >
        <FileIcon
          className={cn(
            "w-5 h-5",
            isOwnMessage ? "text-primary-foreground" : "text-muted-foreground",
          )}
        />
      </div>

      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            isOwnMessage ? "text-primary-foreground" : "text-foreground",
          )}
          title={attachment.fileName}
        >
          {attachment.fileName}
        </p>
        <p
          className={cn(
            "text-xs",
            isOwnMessage ? "text-primary/40" : "text-muted-foreground",
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
            ? "hover:bg-accent/30 text-primary-foreground"
            : "hover:bg-muted text-muted-foreground",
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

  const isImage = (a: MessageAttachment) => a.mimeType.startsWith("image/");
  const isVideo = (a: MessageAttachment) => a.mimeType.startsWith("video/");

  const imageAttachments = attachments.filter(isImage);
  const videoAttachments = attachments.filter(isVideo);
  const fileAttachments = attachments.filter((a) => !isImage(a) && !isVideo(a));

  return (
    <div className="mt-2 space-y-2">
      {/* Video attachments */}
      {videoAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {videoAttachments.map((attachment) => (
            <VideoAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}

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
