import { useEffect, useState } from "react";
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

function useFileDownloadUrl(fileKey: string | null, enabled = true) {
  return useQuery({
    // External pass-through attachments (fileKey === null) have no key to
    // presign — disable the query and let callers fall back to fileUrl.
    enabled: enabled && fileKey !== null,
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

const MIME_TYPE_LABELS: Array<[needle: string, label: string]> = [
  ["pdf", "PDF"],
  ["word", "DOC"],
  ["document", "DOC"],
  ["spreadsheet", "XLS"],
  ["excel", "XLS"],
  ["presentation", "PPT"],
  ["powerpoint", "PPT"],
  ["zip", "ZIP"],
  ["text/", "TXT"],
];

function getFileTypeLabel(attachment: MessageAttachment): string {
  const fileName = attachment.fileName.trim();
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    const extension = fileName.slice(lastDotIndex + 1).trim();
    if (/^[a-z0-9]+$/i.test(extension) && extension.length <= 8) {
      return extension.toUpperCase();
    }
  }

  const mimeType = attachment.mimeType.toLowerCase();
  return (
    MIME_TYPE_LABELS.find(([needle]) => mimeType.includes(needle))?.[1] ??
    "FILE"
  );
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
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const thumbnailUrl = attachment.thumbnailUrl ?? null;
  const shouldUseThumbnail =
    thumbnailUrl !== null && failedImageUrl !== thumbnailUrl;
  const shouldFetchOriginalUrl =
    attachment.fileKey !== null && (!shouldUseThumbnail || isPreviewOpen);
  const { data, isLoading, error, refetch } = useFileDownloadUrl(
    attachment.fileKey,
    shouldFetchOriginalUrl,
  );
  // External attachments resolve via fileUrl directly (no presign needed).
  const originalImageUrl =
    attachment.fileKey === null ? attachment.fileUrl : (data?.url ?? null);
  const imageUrl = shouldUseThumbnail ? thumbnailUrl : originalImageUrl;
  const previewImageUrl = originalImageUrl ?? imageUrl;
  const box = getImageBox(attachment);
  const hasImageError =
    Boolean(error) || (imageUrl !== null && failedImageUrl === imageUrl);

  useEffect(() => {
    setFailedImageUrl(null);
  }, [attachment.id, attachment.fileKey, thumbnailUrl]);

  const handleRetry = () => {
    if (attachment.fileKey === null) {
      setFailedImageUrl(null);
      return;
    }

    void refetch().then((result) => {
      if (!result.error) setFailedImageUrl(null);
    });
  };

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

  if (hasImageError || !imageUrl) {
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
          {hasImageError ? "Failed to load image" : "Image not available"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRetry}
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
          onError={() => setFailedImageUrl(imageUrl)}
          onLoad={() => {
            if (failedImageUrl === imageUrl) setFailedImageUrl(null);
          }}
          className="object-contain"
          style={{ width: box.width, height: box.height }}
        />
      </button>
      {isPreviewOpen && previewImageUrl && (
        <ImagePreviewDialog
          src={previewImageUrl}
          alt={attachment.fileName}
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
        />
      )}
    </>
  );
}

function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const FileIcon = getFileIcon(attachment.mimeType);
  const fileTypeLabel = getFileTypeLabel(attachment);

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
    <div className="flex min-w-[220px] max-w-[320px] items-center gap-3 rounded-md border border-border/70 bg-background px-3 py-2.5 transition-[border-color,box-shadow,transform] duration-[360ms] ease-in-out hover:-translate-y-px hover:scale-[1.005] hover:border-border hover:shadow-[0_5px_14px_rgba(15,23,42,0.08)] motion-reduce:transition-colors motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
        <FileIcon className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <p
          className="truncate text-sm font-medium leading-5 text-foreground"
          title={attachment.fileName}
        >
          {attachment.fileName}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          <span className="rounded-[3px] border border-border/70 bg-muted/60 px-1 text-[10px] font-medium leading-4 text-muted-foreground">
            {fileTypeLabel}
          </span>
          <span>{formatFileSize(attachment.fileSize)}</span>
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleDownload}
        disabled={isDownloading}
        className="h-8 w-8 flex-shrink-0 rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={`Download ${attachment.fileName}`}
        title={`Download ${attachment.fileName}`}
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
            <FileAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageAttachments;
