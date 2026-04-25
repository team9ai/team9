import { useState } from "react";
import { wikisApi } from "@/services/api/wikis";

/**
 * Read a `File` as a raw base64 string (no `data:...;base64,` prefix).
 *
 * `FileReader.readAsDataURL` yields `"data:<mime>;base64,<payload>"`. Folder9's
 * commit endpoint expects just the payload when `encoding: "base64"`, so we
 * strip everything up to and including the first comma. If the result has no
 * comma (shouldn't happen for a valid image, but we defend in depth), we
 * return an empty string rather than the full data URL.
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve("");
        return;
      }
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : "");
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });
}

/** Hard cap on inline image upload size. Matches the plan's Task 22 spec. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface WikiImageUpload {
  /**
   * Upload `file` under `<basePath>/<uuid>.<ext>` via a folder9 commit and
   * return the committed path. Throws synchronously for the oversize case
   * before touching the network; otherwise rejects with whatever
   * `wikisApi.commit` throws (the caller is expected to surface a toast).
   */
  upload: (file: File, basePath: string) => Promise<string>;
  /** True while an upload commit is in flight. */
  uploading: boolean;
}

/**
 * Upload a single image to a Wiki via folder9's commit endpoint.
 *
 * Each call produces one commit (`"Upload <filename>"`) that creates
 * `{basePath}/{uuid}.{ext}`. The UUID ensures duplicate uploads never collide
 * on path even if the user picks the same source file twice.
 *
 * The hook intentionally doesn't mutate the editor body itself — callers
 * chain the returned path into whatever insertion flow they drive (markdown
 * append, Lexical `insertText`, cover frontmatter write, etc.).
 */
export function useWikiImageUpload(wikiId: string): WikiImageUpload {
  const [uploading, setUploading] = useState(false);

  async function upload(file: File, basePath: string): Promise<string> {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("File too large (max 5 MB)");
    }
    const trimmedBase = basePath.trim();
    if (!trimmedBase) {
      throw new Error("Upload path is required");
    }
    setUploading(true);
    try {
      // Fall back to `bin` if the file has no recognisable extension — the
      // server stores bytes regardless, but an extension still helps folder9
      // serve a useful content-type later.
      const dotIdx = file.name.lastIndexOf(".");
      const ext =
        dotIdx > 0 && dotIdx < file.name.length - 1
          ? file.name.slice(dotIdx + 1)
          : "bin";
      const path = `${trimmedBase}/${crypto.randomUUID()}.${ext}`;
      const content = await fileToBase64(file);
      await wikisApi.commit(wikiId, {
        message: `Upload ${file.name}`,
        files: [
          {
            path,
            content,
            encoding: "base64",
            action: "create",
          },
        ],
      });
      return path;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}
