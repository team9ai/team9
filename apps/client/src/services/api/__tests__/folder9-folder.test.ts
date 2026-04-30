import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BlobDto,
  CommitDto,
  CommitRequest,
  CommitResult,
  TreeEntryDto,
} from "../folder9-folder";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../http", () => ({
  __esModule: true,
  default: mockHttp,
}));

import { routineFolderApi, wikiFolderApi } from "../folder9-folder";

// ─── Fixtures ────────────────────────────────────────────────────

const fakeTree: TreeEntryDto[] = [
  { name: "SKILL.md", path: "/SKILL.md", type: "file", size: 42 },
  { name: "scripts", path: "/scripts", type: "dir", size: 0 },
];

// folder9's blob wire shape includes `size`; the factory drops it.
const fakeRoutineBlobWire = {
  path: "/SKILL.md",
  size: 42,
  content: "# hello",
  encoding: "text" as const,
};

// folder9's commit wire shape: snake_case proposal_id, plus a `branch`
// field the factory drops because the shell never reads it.
const fakeRoutineCommitWire = {
  commit: "deadbeef",
  branch: "main",
};

const fakeRoutineCommitProposalWire = {
  commit: "cafef00d",
  branch: "proposal/foo",
  proposal_id: "p-99",
};

// folder9's PascalCase log entries — the factory normalises to camelCase.
const fakeRoutineHistoryWire = [
  {
    SHA: "abc123",
    Message: "init",
    AuthorName: "Alice",
    AuthorEmail: "alice@example.com",
    Time: "2026-04-27T10:00:00Z",
  },
];

// ─── routineFolderApi ────────────────────────────────────────────

describe("routineFolderApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchTree() with no opts hits /folder/tree without params", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    const api = routineFolderApi("r-1");
    const result = await api.fetchTree();
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/tree",
      undefined,
    );
    expect(result).toEqual(fakeTree);
  });

  it("fetchTree() forwards path + recursive=true", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    const api = routineFolderApi("r-1");
    await api.fetchTree({ path: "/scripts", recursive: true });
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/routines/r-1/folder/tree", {
      params: { path: "/scripts", recursive: "true" },
    });
  });

  it("fetchTree() omits recursive when false", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    const api = routineFolderApi("r-1");
    await api.fetchTree({ recursive: false });
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/tree",
      undefined,
    );
  });

  it("fetchBlob() projects the wire response down to BlobDto (drops size)", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeRoutineBlobWire });
    const api = routineFolderApi("r-1");
    const result = await api.fetchBlob("/SKILL.md");
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/routines/r-1/folder/blob", {
      params: { path: "/SKILL.md" },
    });
    const expected: BlobDto = {
      path: "/SKILL.md",
      content: "# hello",
      encoding: "text",
    };
    expect(result).toEqual(expected);
  });

  it("commit() posts the request and maps {commit,branch} -> {sha}", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: fakeRoutineCommitWire });
    const api = routineFolderApi("r-1");
    const req: CommitRequest = {
      message: "feat: init",
      files: [
        {
          path: "/SKILL.md",
          content: "# hi",
          encoding: "text",
          action: "create",
        },
      ],
    };
    const result = await api.commit(req);
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/commit",
      req,
    );
    const expected: CommitResult = { sha: "deadbeef", proposalId: undefined };
    expect(result).toEqual(expected);
  });

  it("commit() maps proposal_id -> proposalId when present", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: fakeRoutineCommitProposalWire,
    });
    const api = routineFolderApi("r-1");
    const result = await api.commit({
      message: "fix",
      files: [],
      propose: true,
    });
    expect(result).toEqual({ sha: "cafef00d", proposalId: "p-99" });
  });

  it("commit() forwards client-side propose hint to the server", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: fakeRoutineCommitWire });
    const api = routineFolderApi("r-1");
    await api.commit({ message: "x", files: [], propose: true });
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/commit",
      { message: "x", files: [], propose: true },
    );
  });

  it("fetchHistory() with no opts hits /folder/history without params and normalises shape", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeRoutineHistoryWire });
    const api = routineFolderApi("r-1");
    expect(api.fetchHistory).toBeDefined();
    const result = await api.fetchHistory!();
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/history",
      undefined,
    );
    const expected: CommitDto[] = [
      {
        sha: "abc123",
        message: "init",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        time: "2026-04-27T10:00:00Z",
      },
    ];
    expect(result).toEqual(expected);
  });

  it("fetchHistory() forwards path/limit/ref params", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [] });
    const api = routineFolderApi("r-1");
    await api.fetchHistory!({ path: "/SKILL.md", limit: 10, ref: "main" });
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/history",
      { params: { path: "/SKILL.md", limit: "10", ref: "main" } },
    );
  });

  it("fetchHistory() coerces limit=0 into the params (not omitted)", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [] });
    const api = routineFolderApi("r-1");
    await api.fetchHistory!({ limit: 0 });
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/routines/r-1/folder/history",
      { params: { limit: "0" } },
    );
  });

  it("propagates http errors from fetchTree", async () => {
    mockHttp.get.mockRejectedValueOnce(new Error("boom"));
    const api = routineFolderApi("r-1");
    await expect(api.fetchTree()).rejects.toThrow("boom");
  });

  it("propagates http errors from fetchBlob", async () => {
    mockHttp.get.mockRejectedValueOnce(new Error("404"));
    const api = routineFolderApi("r-1");
    await expect(api.fetchBlob("/missing.md")).rejects.toThrow("404");
  });

  it("propagates http errors from commit", async () => {
    mockHttp.post.mockRejectedValueOnce(new Error("403 forbidden"));
    const api = routineFolderApi("r-1");
    await expect(api.commit({ message: "nope", files: [] })).rejects.toThrow(
      "403 forbidden",
    );
  });

  it("propagates http errors from fetchHistory", async () => {
    mockHttp.get.mockRejectedValueOnce(new Error("500"));
    const api = routineFolderApi("r-1");
    await expect(api.fetchHistory!()).rejects.toThrow("500");
  });

  it("encodes the routineId into every URL", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [] });
    mockHttp.get.mockResolvedValueOnce({ data: fakeRoutineBlobWire });
    mockHttp.post.mockResolvedValueOnce({ data: fakeRoutineCommitWire });
    mockHttp.get.mockResolvedValueOnce({ data: [] });
    const api = routineFolderApi("uuid-abc");
    await api.fetchTree();
    await api.fetchBlob("/x.md");
    await api.commit({ message: "m", files: [] });
    await api.fetchHistory!();
    expect(mockHttp.get.mock.calls[0]?.[0]).toBe(
      "/v1/routines/uuid-abc/folder/tree",
    );
    expect(mockHttp.get.mock.calls[1]?.[0]).toBe(
      "/v1/routines/uuid-abc/folder/blob",
    );
    expect(mockHttp.post.mock.calls[0]?.[0]).toBe(
      "/v1/routines/uuid-abc/folder/commit",
    );
    expect(mockHttp.get.mock.calls[2]?.[0]).toBe(
      "/v1/routines/uuid-abc/folder/history",
    );
  });
});

// ─── wikiFolderApi ───────────────────────────────────────────────

describe("wikiFolderApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchTree() with no opts omits the params block", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    const api = wikiFolderApi("w-1");
    const result = await api.fetchTree();
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/w-1/tree", undefined);
    expect(result).toEqual(fakeTree);
  });

  it("fetchTree() forwards path + recursive=true", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    const api = wikiFolderApi("w-1");
    await api.fetchTree({ path: "/", recursive: true });
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/w-1/tree", {
      params: { path: "/", recursive: "true" },
    });
  });

  it("fetchBlob() drops PageDto frontmatter + lastCommit", async () => {
    const richPage = {
      path: "/intro.md",
      content: "hello",
      encoding: "text" as const,
      frontmatter: { icon: "book" },
      lastCommit: {
        sha: "deadbeef",
        author: "alice",
        timestamp: "2026-04-27T00:00:00Z",
      },
    };
    mockHttp.get.mockResolvedValueOnce({ data: richPage });
    const api = wikiFolderApi("w-1");
    const result = await api.fetchBlob("/intro.md");
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/w-1/pages", {
      params: { path: "/intro.md" },
    });
    expect(result).toEqual({
      path: "/intro.md",
      content: "hello",
      encoding: "text",
    });
    // Make sure frontmatter / lastCommit didn't leak.
    expect(result).not.toHaveProperty("frontmatter");
    expect(result).not.toHaveProperty("lastCommit");
  });

  it("commit() posts and unwraps {commit:{sha}, proposal:null}", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: { commit: { sha: "wsha-1" }, proposal: null },
    });
    const api = wikiFolderApi("w-1");
    const result = await api.commit({
      message: "edit",
      files: [{ path: "/intro.md", content: "x", action: "update" }],
    });
    expect(mockHttp.post).toHaveBeenCalledWith("/v1/wikis/w-1/commit", {
      message: "edit",
      files: [{ path: "/intro.md", content: "x", action: "update" }],
      propose: undefined,
    });
    expect(result).toEqual({ sha: "wsha-1", proposalId: undefined });
  });

  it("commit() maps proposal.id -> proposalId when the wiki routed through review", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: {
        commit: { sha: "wsha-2" },
        proposal: { id: "wp-1", status: "pending" },
      },
    });
    const api = wikiFolderApi("w-1");
    const result = await api.commit({
      message: "edit",
      files: [],
      propose: true,
    });
    expect(result).toEqual({ sha: "wsha-2", proposalId: "wp-1" });
  });

  it("does not expose fetchHistory (wiki has no history endpoint in v1)", () => {
    const api = wikiFolderApi("w-1");
    expect(api.fetchHistory).toBeUndefined();
  });

  it("propagates http errors from commit", async () => {
    mockHttp.post.mockRejectedValueOnce(new Error("409 conflict"));
    const api = wikiFolderApi("w-1");
    await expect(api.commit({ message: "nope", files: [] })).rejects.toThrow(
      "409 conflict",
    );
  });
});
