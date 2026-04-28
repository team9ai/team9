import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileApi } from "@/services/api/file";
import type { MessageAttachment } from "@/types/im";

// Mirror the same stale-time used by ImageAttachment so remounted video rows
// reuse cached presigned URLs instead of re-fetching on every virtualised mount.
const DOWNLOAD_URL_STALE_TIME = 7 * 60 * 60 * 1000;

function useFileDownloadUrl(fileKey: string) {
  return useQuery({
    queryKey: ["file-download-url", fileKey],
    queryFn: () => fileApi.getDownloadUrl(fileKey),
    staleTime: DOWNLOAD_URL_STALE_TIME,
    gcTime: DOWNLOAD_URL_STALE_TIME,
  });
}

export function VideoAttachment({
  attachment,
  className,
}: {
  attachment: MessageAttachment;
  className?: string;
}) {
  const { data, isLoading } = useFileDownloadUrl(attachment.fileKey);
  const url = data?.url ?? null;
  const aspect =
    attachment.width && attachment.height
      ? `${attachment.width} / ${attachment.height}`
      : "16 / 9";

  if (isLoading && !url) {
    return (
      <div
        className={cn(
          "max-w-[480px] rounded-md border border-border flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground",
          className,
        )}
        style={{ aspectRatio: aspect }}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading video…</span>
      </div>
    );
  }

  if (!url) {
    return null;
  }

  return (
    <video
      controls
      preload="metadata"
      src={url}
      title={attachment.fileName}
      className={cn("max-w-[480px] rounded-md", className)}
      style={{ aspectRatio: aspect }}
    />
  );
}

export default VideoAttachment;
