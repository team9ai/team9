import { useTranslation } from "react-i18next";
import {
  FileDown,
  File,
  FileImage,
  FileText,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  FileVideo,
  FileAudio,
} from "lucide-react";
import type { AgentTaskDeliverable } from "@/types/task";

interface TaskDeliverableListProps {
  deliverables: AgentTaskDeliverable[];
}

function getFileIcon(mimeType: string | null, fileName: string) {
  const mime = mimeType?.toLowerCase() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Image types
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)
  ) {
    return FileImage;
  }

  // PDF
  if (mime === "application/pdf" || ext === "pdf") {
    return FileText;
  }

  // Documents (Word, text, markdown)
  if (
    mime.startsWith("text/") ||
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    mime.includes("opendocument.text") ||
    ["doc", "docx", "txt", "md", "rtf", "odt"].includes(ext)
  ) {
    return FileText;
  }

  // Spreadsheets
  if (
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.includes("opendocument.spreadsheet") ||
    ["xls", "xlsx", "csv", "ods"].includes(ext)
  ) {
    return FileSpreadsheet;
  }

  // Code files
  if (
    mime.includes("javascript") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("html") ||
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "h",
      "css",
      "html",
      "xml",
      "json",
      "yaml",
      "yml",
      "toml",
      "sh",
    ].includes(ext)
  ) {
    return FileCode;
  }

  // Archives
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("gzip") ||
    mime.includes("compressed") ||
    mime.includes("archive") ||
    ["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext)
  ) {
    return FileArchive;
  }

  // Video
  if (
    mime.startsWith("video/") ||
    ["mp4", "avi", "mov", "mkv", "webm"].includes(ext)
  ) {
    return FileVideo;
  }

  // Audio
  if (
    mime.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "flac", "aac"].includes(ext)
  ) {
    return FileAudio;
  }

  return File;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function TaskDeliverableList({
  deliverables,
}: TaskDeliverableListProps) {
  const { t } = useTranslation("tasks");

  if (deliverables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.noDeliverables")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {deliverables.map((d) => {
        const Icon = getFileIcon(d.mimeType, d.fileName);
        return (
          <a
            key={d.id}
            href={d.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 transition-colors group"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded bg-muted text-muted-foreground group-hover:text-foreground">
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{d.fileName}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {d.mimeType && <span>{d.mimeType}</span>}
                {d.fileSize != null && d.fileSize > 0 && (
                  <>
                    {d.mimeType && <span>·</span>}
                    <span>{formatFileSize(d.fileSize)}</span>
                  </>
                )}
              </div>
            </div>
            <FileDown
              size={16}
              className="text-muted-foreground group-hover:text-foreground shrink-0"
            />
          </a>
        );
      })}
    </div>
  );
}
