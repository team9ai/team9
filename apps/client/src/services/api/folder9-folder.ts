import http from "../http";
import type {
  CommitFileInput as WikiCommitFileInput,
  CommitPageResponse,
  PageDto,
  TreeEntryDto as WikiTreeEntryDto,
} from "@/types/wiki";

/**
 * Folder9 folder editor — generic data layer.
 *
 * This module decouples the upcoming `<Folder9FolderEditor>` shell
 * (Phase C.2) from any single product surface. Both the wiki page
 * editor and the routine skill-folder editor mount the same shell
 * over a `Folder9FolderApi` instance — the wiki impl wraps
 * `/v1/wikis/:id/{tree,pages,commit}`, and the routine impl wraps
 * `/v1/routines/:id/folder/{tree,blob,commit,history}` (added in
 * Phase A.6).
 *
 * Wire-format normalisation
 * -------------------------
 * The two server endpoints return slightly different shapes:
 *
 *   - Wiki tree entries use `type: "file" | "dir"` and ship as
 *     camelCase (`{name, path, type, size}`); the gateway already
 *     translated folder9's snake_case for the wiki UI's sake.
 *   - Wiki page reads return a richer `PageDto` (frontmatter +
 *     lastCommit) over `/v1/wikis/:id/pages`; the routine folder
 *     proxy returns folder9's lean `Folder9BlobResponse` over
 *     `/blob`.
 *   - Wiki commit responses are `{commit:{sha}, proposal: ... | null}`;
 *     the routine proxy passes folder9's `{commit, branch,
 *     proposal_id?}` through verbatim.
 *   - Wiki has no public history endpoint yet; the routine proxy
 *     returns folder9's PascalCase `Folder9LogEntry[]` from
 *     `/folder/history`.
 *
 * The factories below normalise these into a single set of camelCase
 * DTOs so the shell can be polymorphic over folder source without
 * branching on `kind === "wiki"`. The lossy fields the shell never
 * reads (frontmatter, lastCommit, branch) are dropped at the factory
 * boundary; consumers that need them keep their existing dedicated
 * hooks (e.g. `useWikiPage` continues to expose the rich `PageDto`
 * for the cover/icon UI).
 */

/** One entry in the response of `Folder9FolderApi.fetchTree()`. */
export interface TreeEntryDto {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

/**
 * Lean blob shape consumed by the editor shell.
 *
 * We expose only the fields the shell needs — content + encoding —
 * so the wiki impl (which has frontmatter + lastCommit) and the
 * routine impl (which has size only) project to the same shape.
 *
 * `encoding === "base64"` means `content` is the raw base64 payload
 * (no `data:` prefix); `"text"` means UTF-8 decoded text.
 */
export interface BlobDto {
  path: string;
  content: string;
  encoding: "text" | "base64";
}

/** One file change in a commit request. */
export interface FileChange {
  path: string;
  content: string;
  encoding?: "text" | "base64";
  action: "create" | "update" | "delete";
}

/**
 * Body for `Folder9FolderApi.commit(req)`.
 *
 * `propose` is a CLIENT HINT only — the server recomputes the
 * effective propose flag from the folder's `approval_mode` × the
 * caller's permission. It exists so a future "force review" toggle
 * for write-permission users has somewhere to live without changing
 * the wire format.
 */
export interface CommitRequest {
  message: string;
  files: FileChange[];
  propose?: boolean;
}

/**
 * Result of a successful commit.
 *
 * `proposalId` is non-null iff the server routed the change through
 * a proposal branch (review mode + propose permission). Direct
 * commits leave it `undefined`.
 */
export interface CommitResult {
  sha: string;
  proposalId?: string;
}

/**
 * One entry in `Folder9FolderApi.fetchHistory()`.
 *
 * Field names are camelCase here — folder9's wire format is
 * PascalCase but we normalise inside `routineFolderApi` so the
 * shell consumes one shape regardless of source.
 */
export interface CommitDto {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** RFC3339 commit author timestamp. */
  time: string;
}

/**
 * Generic folder API shape consumed by `<Folder9FolderEditor>`.
 *
 * `fetchHistory` is optional — the wiki side has no history endpoint
 * in v1, and the shell renders the history sidebar conditionally
 * based on whether it's defined.
 */
export interface Folder9FolderApi {
  fetchTree(opts?: {
    path?: string;
    recursive?: boolean;
  }): Promise<TreeEntryDto[]>;
  fetchBlob(path: string): Promise<BlobDto>;
  commit(req: CommitRequest): Promise<CommitResult>;
  fetchHistory?(opts?: {
    path?: string;
    limit?: number;
    ref?: string;
  }): Promise<CommitDto[]>;
}

// ─── Routine folder ──────────────────────────────────────────────

/** Wire shape of one entry in folder9's `GET .../log` response. */
interface RoutineHistoryWireEntry {
  SHA: string;
  Message: string;
  AuthorName: string;
  AuthorEmail: string;
  Time: string;
}

/** Wire shape of folder9's `GET .../blob` response (passed through by the gateway). */
interface RoutineBlobWireResponse {
  path: string;
  size: number;
  content: string;
  encoding: "text" | "base64";
}

/** Wire shape of folder9's `POST .../commit` response (passed through by the gateway). */
interface RoutineCommitWireResponse {
  commit?: string;
  branch?: string;
  status?: string;
  proposal_id?: string;
}

interface LegacySkillFileWire {
  path: string;
  content: string;
}

interface LegacySkillDetailWire {
  name: string;
  description: string | null;
  files: LegacySkillFileWire[];
}

interface LegacySkillVersionWire {
  version: number;
}

/**
 * Folder9 folder API bound to a routine's `/v1/routines/:id/folder/*`
 * proxy endpoints (Phase A.6 — see
 * `apps/server/apps/gateway/src/routines/routines.controller.ts`).
 *
 * The routine proxy passes folder9's native wire format through
 * verbatim, so this factory does the camelCase normalisation the
 * wiki gateway does on the server side.
 */
export function routineFolderApi(routineId: string): Folder9FolderApi {
  const base = `/v1/routines/${routineId}/folder`;

  return {
    fetchTree: async ({ path, recursive } = {}) => {
      const params: Record<string, string> = {};
      if (path) params.path = path;
      if (recursive) params.recursive = "true";
      const response = await http.get<TreeEntryDto[]>(
        `${base}/tree`,
        Object.keys(params).length > 0 ? { params } : undefined,
      );
      return response.data;
    },

    fetchBlob: async (path: string) => {
      const response = await http.get<RoutineBlobWireResponse>(`${base}/blob`, {
        params: { path },
      });
      const { data } = response;
      return {
        path: data.path,
        content: data.content,
        encoding: data.encoding,
      };
    },

    commit: async (req: CommitRequest) => {
      const response = await http.post<RoutineCommitWireResponse>(
        `${base}/commit`,
        req,
      );
      const { data } = response;
      return {
        sha: data.commit ?? data.status ?? "applied",
        proposalId: data.proposal_id,
      };
    },

    fetchHistory: async ({ path, limit, ref } = {}) => {
      const params: Record<string, string> = {};
      if (path) params.path = path;
      if (limit !== undefined) params.limit = String(limit);
      if (ref) params.ref = ref;
      const response = await http.get<RoutineHistoryWireEntry[]>(
        `${base}/history`,
        Object.keys(params).length > 0 ? { params } : undefined,
      );
      return response.data.map((entry) => ({
        sha: entry.SHA,
        message: entry.Message,
        authorName: entry.AuthorName,
        authorEmail: entry.AuthorEmail,
        time: entry.Time,
      }));
    },
  };
}

// ─── Skill folder ───────────────────────────────────────────────────

/**
 * Folder9 light-folder API bound to a skill's
 * `/v1/skills/:id/folder/{tree,blob,commit}` proxy endpoints.
 *
 * Skills use folder9 light folders rather than the legacy
 * `skill_files` / `skill_versions` tables; the gateway keeps folder9
 * tokens server-side and exposes the same lean editor contract as
 * routine folders.
 */
export function skillFolderApi(skillId: string): Folder9FolderApi {
  const base = `/v1/skills/${skillId}/folder`;

  return {
    fetchTree: async ({ path, recursive } = {}) => {
      const params: Record<string, string> = {};
      if (path) params.path = path;
      if (recursive) params.recursive = "true";
      try {
        const response = await http.get<TreeEntryDto[]>(
          `${base}/tree`,
          Object.keys(params).length > 0 ? { params } : undefined,
        );
        return response.data;
      } catch (error) {
        if (!isMissingSkillFolderRoute(error)) throw error;
        const files = await fetchLegacySkillFiles(skillId);
        return buildLegacyTree(files, path, recursive);
      }
    },

    fetchBlob: async (path: string) => {
      try {
        const response = await http.get<RoutineBlobWireResponse>(
          `${base}/blob`,
          { params: { path } },
        );
        const { data } = response;
        return {
          path: data.path,
          content: data.content,
          encoding: data.encoding,
        };
      } catch (error) {
        if (!isMissingSkillFolderRoute(error)) throw error;
        const files = await fetchLegacySkillFiles(skillId);
        const file = files.find((entry) => entry.path === normalizePath(path));
        if (!file) throw error;
        return {
          path: file.path,
          content: file.content,
          encoding: "text",
        };
      }
    },

    commit: async (req: CommitRequest) => {
      try {
        const response = await http.post<RoutineCommitWireResponse>(
          `${base}/commit`,
          req,
        );
        const { data } = response;
        return {
          sha: data.commit ?? data.status ?? "applied",
          proposalId: data.proposal_id,
        };
      } catch (error) {
        if (!isMissingSkillFolderRoute(error)) throw error;
        const files = await fetchLegacySkillFiles(skillId);
        const nextFiles = mergeLegacySkillFiles(files, req.files);
        const response = await http.post<LegacySkillVersionWire>(
          `/v1/skills/${skillId}/versions`,
          {
            message: req.message,
            files: nextFiles,
            status: "published",
          },
        );
        return {
          sha: `legacy-v${response.data.version}`,
          proposalId: undefined,
        };
      }
    },
  };
}

function isMissingSkillFolderRoute(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const response = (
    error as {
      response?: { status?: number; data?: unknown };
    }
  ).response;
  if (response?.status !== 404) return false;

  const data = response.data;
  return typeof data === "string" && data.includes("/folder/");
}

async function fetchLegacySkillFiles(
  skillId: string,
): Promise<LegacySkillFileWire[]> {
  const response = await http.get<LegacySkillDetailWire>(
    `/v1/skills/${skillId}`,
  );
  const detail = response.data;
  if (detail.files.length > 0) {
    return detail.files.map((file) => ({
      path: normalizePath(file.path),
      content: file.content,
    }));
  }

  return [
    {
      path: "skill.md",
      content: detail.description?.trim()
        ? `# ${detail.name}\n\n${detail.description.trim()}\n`
        : `# ${detail.name}\n\nDescribe when and how to use this skill.\n`,
    },
  ];
}

function buildLegacyTree(
  files: LegacySkillFileWire[],
  rootPath?: string,
  recursive?: boolean,
): TreeEntryDto[] {
  const root = normalizePath(rootPath ?? "");
  const entries = new Map<string, TreeEntryDto>();

  for (const file of files) {
    const path = normalizePath(file.path);
    if (root && path !== root && !path.startsWith(`${root}/`)) continue;

    const relative = root ? path.slice(root.length).replace(/^\//, "") : path;
    if (!recursive && relative.includes("/")) {
      const dirName = relative.split("/")[0];
      const dirPath = root ? `${root}/${dirName}` : dirName;
      entries.set(dirPath, {
        name: dirName,
        path: dirPath,
        type: "dir",
        size: 0,
      });
      continue;
    }

    const segments = path.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      const dirPath = segments.slice(0, i).join("/");
      if (!entries.has(dirPath)) {
        entries.set(dirPath, {
          name: segments[i - 1],
          path: dirPath,
          type: "dir",
          size: 0,
        });
      }
    }

    entries.set(path, {
      name: segments[segments.length - 1] ?? path,
      path,
      type: "file",
      size: new TextEncoder().encode(file.content).length,
    });
  }

  return [...entries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function mergeLegacySkillFiles(
  currentFiles: LegacySkillFileWire[],
  changes: FileChange[],
): LegacySkillFileWire[] {
  const byPath = new Map(
    currentFiles.map((file) => [
      normalizePath(file.path),
      { path: normalizePath(file.path), content: file.content },
    ]),
  );

  for (const change of changes) {
    const path = normalizePath(change.path);
    if (change.action === "delete") {
      byPath.delete(path);
    } else {
      byPath.set(path, { path, content: change.content });
    }
  }

  return [...byPath.values()];
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

// ─── Wiki folder ─────────────────────────────────────────────────

/**
 * Folder9 folder API bound to a wiki's `/v1/wikis/:id/{tree,pages,commit}`
 * endpoints. Behaviour matches the existing methods on `wikisApi`
 * verbatim; this factory is a thin adapter that maps the wiki's
 * richer DTOs down to the lean `Folder9FolderApi` shape so the
 * shared editor shell doesn't have to know about wiki-specific
 * frontmatter / lastCommit fields.
 *
 * `fetchHistory` is intentionally omitted — wikis have no history
 * endpoint in v1.
 */
export function wikiFolderApi(wikiId: string): Folder9FolderApi {
  const base = `/v1/wikis/${wikiId}`;

  return {
    fetchTree: async ({ path, recursive } = {}) => {
      const params: Record<string, string> = {};
      if (path) params.path = path;
      if (recursive) params.recursive = "true";
      const response = await http.get<WikiTreeEntryDto[]>(
        `${base}/tree`,
        Object.keys(params).length > 0 ? { params } : undefined,
      );
      // WikiTreeEntryDto already matches TreeEntryDto field-for-field.
      return response.data;
    },

    fetchBlob: async (path: string) => {
      const response = await http.get<PageDto>(`${base}/pages`, {
        params: { path },
      });
      const { data } = response;
      return {
        path: data.path,
        content: data.content,
        encoding: data.encoding,
      };
    },

    commit: async (req: CommitRequest) => {
      // `FileChange` is structurally identical to wiki's
      // `CommitFileInput` — same field names, same enum literals —
      // so the body forwards unchanged. The local typed binding
      // catches any drift between the two definitions at compile
      // time.
      const wikiFiles: WikiCommitFileInput[] = req.files;
      const response = await http.post<CommitPageResponse>(`${base}/commit`, {
        message: req.message,
        files: wikiFiles,
        propose: req.propose,
      });
      const { data } = response;
      return {
        sha: data.commit.sha,
        proposalId: data.proposal?.id,
      };
    },
  };
}
