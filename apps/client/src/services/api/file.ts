import http from "../http";

export type FileVisibility = "private" | "channel" | "workspace" | "public";

export interface PresignedUploadCredentials {
  url: string;
  key: string;
  fields: Record<string, string>;
}

export interface CreatePresignedUploadDto {
  filename: string;
  contentType: string;
  fileSize: number;
  visibility?: FileVisibility;
  channelId?: string;
}

export interface ConfirmUploadDto {
  key: string;
  fileName: string;
  visibility?: FileVisibility;
  channelId?: string;
}

export interface ConfirmUploadResult {
  id: string;
  key: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  visibility: FileVisibility;
}

export interface DownloadUrlResult {
  url: string;
  expiresAt: string;
}

export interface FileRecord {
  id: string;
  key: string;
  bucket: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  visibility: FileVisibility;
  tenantId: string;
  channelId?: string;
  uploaderId: string;
  createdAt: string;
}

export const fileApi = {
  /**
   * Get presigned upload credentials
   * Files are automatically tagged as 'pending' and will be auto-deleted after 1 day if not confirmed
   */
  createPresignedUpload: async (
    dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadCredentials> => {
    const response = await http.post<PresignedUploadCredentials>(
      "/v1/files/presign",
      dto,
    );
    return response.data;
  },

  /**
   * Confirm upload - changes tag from 'pending' to 'confirmed'
   * This saves the file record to database and makes the file permanent
   */
  confirmUpload: async (
    dto: ConfirmUploadDto,
  ): Promise<ConfirmUploadResult> => {
    const response = await http.post<ConfirmUploadResult>(
      "/v1/files/confirm",
      dto,
    );
    return response.data;
  },

  /**
   * Get presigned download URL for a file
   * Validates access permissions before generating URL
   */
  getDownloadUrl: async (
    key: string,
    expiresIn?: number,
  ): Promise<DownloadUrlResult> => {
    const params = expiresIn ? { expiresIn } : undefined;
    const response = await http.get<DownloadUrlResult>(
      `/v1/files/${encodeURIComponent(key)}/download-url`,
      { params },
    );
    return response.data;
  },

  /**
   * Get public download URL (for public files only, no auth required)
   */
  getPublicDownloadUrl: async (
    key: string,
    expiresIn?: number,
  ): Promise<DownloadUrlResult> => {
    const params = expiresIn ? { expiresIn } : undefined;
    const response = await http.get<DownloadUrlResult>(
      `/v1/files/public/${encodeURIComponent(key)}/download-url`,
      { params },
    );
    return response.data;
  },

  /**
   * Update file visibility
   */
  updateVisibility: async (
    key: string,
    visibility: FileVisibility,
    channelId?: string,
  ): Promise<FileRecord> => {
    const response = await http.patch<FileRecord>(
      `/v1/files/${encodeURIComponent(key)}/visibility`,
      { visibility, channelId },
    );
    return response.data;
  },

  /**
   * Delete a file
   */
  deleteFile: async (key: string): Promise<{ success: boolean }> => {
    const response = await http.delete<{ success: boolean }>(
      `/v1/files/${encodeURIComponent(key)}`,
    );
    return response.data;
  },

  /**
   * Upload a file directly to S3 using presigned POST URL
   * Uses FormData with fields from presigned credentials
   */
  uploadToS3: async (
    presignedUrl: string,
    file: File,
    fields: Record<string, string>,
    onProgress?: (progress: number) => void,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Build FormData with presigned fields
      const formData = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      // File must be appended last for S3 POST upload
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        // S3 POST returns 204 on success
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed"));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("Upload aborted"));
      });

      xhr.open("POST", presignedUrl);
      // Don't set Content-Type header - browser will set it with boundary for FormData
      xhr.send(formData);
    });
  },
};

export default fileApi;
