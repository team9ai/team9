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

function AttachmentItem({
  file,
  onRemove,
  onRetry,
}: {
  file: UploadingFile;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const FileIcon = getFileIcon(file.file.type);
  const isImage = file.file.type.startsWith("image/");
  const isError = file.status === "error";
  const isUploading =
    file.status === "uploading" || file.status === "confirming";
  const isCompleted = file.status === "completed";

  return (
    <div
      className={cn(
        "relative group flex items-center gap-2 p-2 rounded-lg border bg-white",
        isError && "border-red-300 bg-red-50",
        isCompleted && "border-green-300 bg-green-50",
        isUploading && "border-purple-300 bg-purple-50",
      )}
    >
      {/* Preview or Icon */}
      <div className="w-10 h-10 flex-shrink-0 rounded bg-slate-100 flex items-center justify-center overflow-hidden">
        {isImage && file.status === "completed" ? (
          <img
            src={URL.createObjectURL(file.file)}
            alt={file.file.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <FileIcon
            className={cn(
              "w-5 h-5",
              isError ? "text-red-500" : "text-slate-500",
            )}
          />
        )}
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-slate-700 truncate max-w-[150px]">
            {file.file.name}
          </span>
          {isError && (
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          )}
          {isUploading && (
            <Loader2 className="w-4 h-4 text-purple-500 animate-spin flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{formatFileSize(file.file.size)}</span>
          {isUploading && (
            <span className="text-purple-600">{file.progress}%</span>
          )}
          {isError && file.error && (
            <span className="text-red-500 truncate max-w-[100px]">
              {file.error}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {isUploading && (
          <div className="mt-1 h-1 bg-purple-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
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
            className="h-6 w-6 p-0 hover:bg-red-100"
            title="Retry upload"
          >
            <RefreshCw className="w-3 h-3 text-red-500" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0 hover:bg-slate-200"
          title="Remove"
          disabled={isUploading}
        >
          <X className="w-3 h-3 text-slate-500" />
        </Button>
      </div>
    </div>
  );
}

export function AttachmentPreview({
  files,
  onRemove,
  onRetry,
}: AttachmentPreviewProps) {
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 p-2 border-t border-slate-100 bg-slate-50 rounded-b-lg">
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
