import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { fileApi, type FileVisibility } from "@/services/api/file";

export interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "confirming" | "completed" | "error";
  error?: string;
  result?: {
    key: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileUrl?: string;
  };
}

export interface UseFileUploadOptions {
  visibility?: FileVisibility;
  channelId?: string;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  onUploadComplete?: (file: UploadingFile) => void;
  onError?: (file: UploadingFile, error: Error) => void;
}

const DEFAULT_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const {
    visibility = "channel",
    channelId,
    maxFiles = 10,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    onUploadComplete,
    onError,
  } = options;

  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);

  const updateFileStatus = useCallback(
    (id: string, updates: Partial<UploadingFile>) => {
      setUploadingFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      );
    },
    [],
  );

  const uploadMutation = useMutation({
    mutationFn: async ({
      id,
      file,
    }: {
      id: string;
      file: File;
    }): Promise<UploadingFile["result"]> => {
      // Step 1: Get presigned upload URL
      updateFileStatus(id, { status: "uploading", progress: 0 });

      const presigned = await fileApi.createPresignedUpload({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
        visibility,
        channelId,
      });

      // Step 2: Upload to S3 using presigned POST
      await fileApi.uploadToS3(
        presigned.url,
        file,
        presigned.fields,
        (progress) => {
          updateFileStatus(id, { progress });
        },
      );

      // Step 3: Confirm upload
      updateFileStatus(id, { status: "confirming", progress: 100 });

      const confirmed = await fileApi.confirmUpload({
        key: presigned.key,
        fileName: file.name,
        visibility,
        channelId,
      });

      return {
        key: confirmed.key,
        fileName: confirmed.fileName,
        fileSize: confirmed.fileSize,
        mimeType: confirmed.mimeType,
      };
    },
    onSuccess: (result, { id }) => {
      const updatedFile: UploadingFile = {
        id,
        file: uploadingFiles.find((f) => f.id === id)?.file!,
        progress: 100,
        status: "completed",
        result,
      };
      updateFileStatus(id, { status: "completed", result });
      onUploadComplete?.(updatedFile);
    },
    onError: (error, { id }) => {
      const file = uploadingFiles.find((f) => f.id === id);
      const errorMessage =
        error instanceof Error ? error.message : "Upload failed";
      updateFileStatus(id, { status: "error", error: errorMessage });
      if (file) {
        onError?.(
          { ...file, status: "error", error: errorMessage },
          error as Error,
        );
      }
    },
  });

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      // Validate file count
      const availableSlots = maxFiles - uploadingFiles.length;
      const filesToAdd = fileArray.slice(0, availableSlots);

      // Validate and create upload entries
      const newFiles: UploadingFile[] = [];

      for (const file of filesToAdd) {
        // Check file size
        if (file.size > maxFileSize) {
          console.warn(
            `File ${file.name} exceeds maximum size of ${maxFileSize} bytes`,
          );
          continue;
        }

        const uploadingFile: UploadingFile = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          progress: 0,
          status: "pending",
        };

        newFiles.push(uploadingFile);
      }

      if (newFiles.length === 0) return;

      setUploadingFiles((prev) => [...prev, ...newFiles]);

      // Start uploading each file
      for (const uploadingFile of newFiles) {
        uploadMutation.mutate({
          id: uploadingFile.id,
          file: uploadingFile.file,
        });
      }
    },
    [maxFiles, maxFileSize, uploadingFiles.length, uploadMutation],
  );

  const removeFile = useCallback((id: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    setUploadingFiles([]);
  }, []);

  const retryFile = useCallback(
    (id: string) => {
      const file = uploadingFiles.find((f) => f.id === id);
      if (file && file.status === "error") {
        updateFileStatus(id, {
          status: "pending",
          progress: 0,
          error: undefined,
        });
        uploadMutation.mutate({ id, file: file.file });
      }
    },
    [uploadingFiles, uploadMutation, updateFileStatus],
  );

  // Get completed file attachments for message sending
  const getAttachments = useCallback(() => {
    return uploadingFiles
      .filter((f) => f.status === "completed" && f.result)
      .map((f) => ({
        fileKey: f.result!.key,
        fileName: f.result!.fileName,
        fileSize: f.result!.fileSize,
        mimeType: f.result!.mimeType,
      }));
  }, [uploadingFiles]);

  const isUploading = uploadingFiles.some(
    (f) => f.status === "uploading" || f.status === "confirming",
  );

  const hasErrors = uploadingFiles.some((f) => f.status === "error");

  const allCompleted =
    uploadingFiles.length > 0 &&
    uploadingFiles.every((f) => f.status === "completed");

  return {
    uploadingFiles,
    addFiles,
    removeFile,
    clearFiles,
    retryFile,
    getAttachments,
    isUploading,
    hasErrors,
    allCompleted,
  };
}

export default useFileUpload;
