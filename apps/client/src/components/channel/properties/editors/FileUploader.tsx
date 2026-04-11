import { useCallback, useRef } from "react";
import { File, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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

export function FileUploader({ value, onChange, disabled }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const fileValue = isFileValue(value) ? value : null;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // V1: store file metadata; actual upload integration can be added later
      onChange({
        fileKey: `pending-${Date.now()}`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [onChange]);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        onChange={handleFileSelect}
        disabled={disabled}
        className="hidden"
      />
      {fileValue ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {fileValue.fileName}
          </span>
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
          disabled={disabled}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          Choose file
        </Button>
      )}
    </div>
  );
}
