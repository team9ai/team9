import {
  X,
  File,
  Image as ImageIcon,
  FileText,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UploadingFile } from "@/hooks/useFileUpload";

interface AttachmentPreviewProps {
  files: UploadingFile[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
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

// Image attachment - Slack style thumbnail
function ImageAttachmentItem({
  file,
  onRemove,
  onRetry,
}: {
  file: UploadingFile;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const isError = file.status === "error";
  const isUploading =
    file.status === "uploading" || file.status === "confirming";

  return (
    <div className="relative group">
      {/* Image thumbnail */}
      <div
        className={cn(
          "w-20 h-20 rounded-lg overflow-hidden border-2",
          isError && "border-destructive/30",
          isUploading && "border-info/30",
          !isError && !isUploading && "border-transparent",
        )}
      >
        <img
          src={URL.createObjectURL(file.file)}
          alt={file.file.name}
          className={cn(
            "w-full h-full object-cover",
            isUploading && "opacity-50",
          )}
        />

        {/* Upload progress overlay */}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/20">
            <Loader2 className="w-6 h-6 text-background animate-spin" />
          </div>
        )}

        {/* Error overlay */}
        {isError && (
          <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
        )}
      </div>

      {/* Remove button - shows on hover */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onRemove}
        disabled={isUploading}
        className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-background border shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove"
      >
        <X className="w-3 h-3 text-muted-foreground" />
      </Button>

      {/* Retry button for errors */}
      {isError && onRetry && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="absolute -bottom-2 -right-2 h-6 w-6 p-0 rounded-full bg-background border shadow-sm"
          title="Retry upload"
        >
          <RefreshCw className="w-3 h-3 text-destructive" />
        </Button>
      )}
    </div>
  );
}

// File attachment - original style (unchanged)
function FileAttachmentItem({
  file,
  onRemove,
  onRetry,
}: {
  file: UploadingFile;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const FileIcon = getFileIcon(file.file.type);
  const isError = file.status === "error";
  const isUploading =
    file.status === "uploading" || file.status === "confirming";
  const isCompleted = file.status === "completed";

  return (
    <div
      className={cn(
        "relative group flex items-center gap-2 p-2 rounded-lg border bg-background",
        isError && "border-destructive/30 bg-destructive/10",
        isCompleted && "border-success/30 bg-success/10",
        isUploading && "border-primary/30 bg-primary/10",
      )}
    >
      {/* Icon */}
      <div className="w-10 h-10 flex-shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
        <FileIcon
          className={cn(
            "w-5 h-5",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        />
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-foreground truncate max-w-[150px]">
            {file.file.name}
          </span>
          {isError && (
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
          )}
          {isUploading && (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatFileSize(file.file.size)}</span>
          {isUploading && (
            <span className="text-primary">{file.progress}%</span>
          )}
          {isError && file.error && (
            <span className="text-destructive truncate max-w-[100px]">
              {file.error}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {isUploading && (
          <div className="mt-1 h-1 bg-primary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isError && onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="h-6 w-6 p-0 hover:bg-destructive/10"
            title="Retry upload"
          >
            <RefreshCw className="w-3 h-3 text-destructive" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0 hover:bg-muted"
          title="Remove"
          disabled={isUploading}
        >
          <X className="w-3 h-3 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function AttachmentItem({
  file,
  onRemove,
  onRetry,
}: {
  file: UploadingFile;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const isImage = file.file.type.startsWith("image/");

  if (isImage) {
    return (
      <ImageAttachmentItem file={file} onRemove={onRemove} onRetry={onRetry} />
    );
  }

  return (
    <FileAttachmentItem file={file} onRemove={onRemove} onRetry={onRetry} />
  );
}

export function AttachmentPreview({
  files,
  onRemove,
  onRetry,
}: AttachmentPreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-3">
      {files.map((file) => (
        <AttachmentItem
          key={file.id}
          file={file}
          onRemove={() => onRemove(file.id)}
          onRetry={onRetry ? () => onRetry(file.id) : undefined}
        />
      ))}
    </div>
  );
}

export default AttachmentPreview;
