import { useCallback, useRef, useState } from "react";
import {
  File,
  Upload,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { fileApi } from "@/services/api/file";
import type { PropertyDefinition } from "@/types/properties";

interface FileValue {
  fileKey: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
}

interface FileUploaderProps {
  definition: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function isFileValue(v: unknown): v is FileValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "fileKey" in v &&
    "fileName" in v &&
    typeof (v as FileValue).fileKey === "string" &&
    typeof (v as FileValue).fileName === "string"
  );
}

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function FileUploader({ value, onChange, disabled }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileValue = isFileValue(value) ? value : null;

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadStatus("uploading");
      setUploadProgress(0);
      setUploadError(null);

      try {
        // Step 1: Get presigned upload credentials
        const presigned = await fileApi.createPresignedUpload({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          fileSize: file.size,
        });

        // Step 2: Upload to S3
        await fileApi.uploadToS3(
          presigned.url,
          file,
          presigned.fields,
          (progress) => setUploadProgress(progress),
        );

        // Step 3: Confirm upload
        const confirmed = await fileApi.confirmUpload({
          key: presigned.key,
          fileName: file.name,
        });

        setUploadStatus("success");

        // Pass the real file key and metadata to onChange
        onChange({
          fileKey: confirmed.key,
          fileName: confirmed.fileName,
          fileSize: confirmed.fileSize,
          mimeType: confirmed.mimeType,
        });

        // Reset status after brief success indicator
        setTimeout(() => setUploadStatus("idle"), 1500);
      } catch (err) {
        setUploadStatus("error");
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setUploadStatus("idle");
    setUploadProgress(0);
    setUploadError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          onChange={handleFileSelect}
          disabled={disabled || uploadStatus === "uploading"}
          className="hidden"
        />
        {fileValue ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {fileValue.fileName}
            </span>
            {fileValue.fileSize && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {fileValue.fileSize < 1024
                  ? `${fileValue.fileSize} B`
                  : fileValue.fileSize < 1048576
                    ? `${(fileValue.fileSize / 1024).toFixed(1)} KB`
                    : `${(fileValue.fileSize / 1048576).toFixed(1)} MB`}
              </span>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploadStatus === "uploading"}
          >
            {uploadStatus === "uploading" ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" />
                Choose file
              </>
            )}
          </Button>
        )}
      </div>

      {/* Upload progress */}
      {uploadStatus === "uploading" && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* Success indicator */}
      {uploadStatus === "success" && (
        <div className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle className="h-3 w-3" />
          <span>Upload complete</span>
        </div>
      )}

      {/* Error */}
      {uploadStatus === "error" && uploadError && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span>{uploadError}</span>
          <button
            onClick={() => inputRef.current?.click()}
            className="ml-1 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
