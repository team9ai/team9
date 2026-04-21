import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommitPageResponse,
  PageDto,
  ProposalDto,
  TreeEntryDto,
  WikiDto,
} from "@/types/wiki";

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

import { wikisApi } from "../wikis";

const fakeWiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "read",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

const fakeTree: TreeEntryDto[] = [
  { name: "intro.md", path: "/intro.md", type: "file", size: 100 },
];

const fakePage: PageDto = {
  path: "/intro.md",
  content: "hello",
  frontmatter: {},
  lastCommit: null,
};

const fakeCommit: CommitPageResponse = {
  commit: { sha: "sha-1" },
  proposal: null,
};

const fakeProposals: ProposalDto[] = [
  {
    id: "p-1",
    wikiId: "wiki-1",
    title: "Fix typo",
    description: "",
    status: "pending",
    authorId: "user-2",
    authorType: "user",
    createdAt: "2026-04-02T00:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
  },
];

describe("wikisApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list() unwraps response data", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [fakeWiki] });
    const result = await wikisApi.list();
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis");
    expect(result).toEqual([fakeWiki]);
  });

  it("create() POSTs to /v1/wikis", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: fakeWiki });
    const dto = { name: "Handbook", slug: "handbook" };
    const result = await wikisApi.create(dto);
    expect(mockHttp.post).toHaveBeenCalledWith("/v1/wikis", dto);
    expect(result).toEqual(fakeWiki);
  });

  it("get() requests detail by id", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeWiki });
    await wikisApi.get("wiki-1");
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/wiki-1");
  });

  it("update() PATCHes with the dto", async () => {
    mockHttp.patch.mockResolvedValueOnce({ data: fakeWiki });
    const dto = { name: "Renamed" };
    const result = await wikisApi.update("wiki-1", dto);
    expect(mockHttp.patch).toHaveBeenCalledWith("/v1/wikis/wiki-1", dto);
    expect(result).toEqual(fakeWiki);
  });

  it("archive() DELETEs the wiki", async () => {
    mockHttp.delete.mockResolvedValueOnce({ data: null });
    await wikisApi.archive("wiki-1");
    expect(mockHttp.delete).toHaveBeenCalledWith("/v1/wikis/wiki-1");
  });

  it("getTree() sends no params when none provided", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    await wikisApi.getTree("wiki-1");
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/tree",
      undefined,
    );
  });

  it("getTree() forwards path only", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    await wikisApi.getTree("wiki-1", { path: "/docs" });
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/wiki-1/tree", {
      params: { path: "/docs" },
    });
  });

  it("getTree() sends recursive=true when requested", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    await wikisApi.getTree("wiki-1", { path: "/", recursive: true });
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/wiki-1/tree", {
      params: { path: "/", recursive: "true" },
    });
  });

  it("getTree() omits recursive when false", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeTree });
    await wikisApi.getTree("wiki-1", { recursive: false });
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/tree",
      undefined,
    );
  });

  it("getPage() sends path as a query param", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakePage });
    const result = await wikisApi.getPage("wiki-1", "/intro.md");
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/wiki-1/pages", {
      params: { path: "/intro.md" },
    });
    expect(result).toEqual(fakePage);
  });

  it("commit() POSTs commit body and returns response", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: fakeCommit });
    const dto = {
      message: "update",
      files: [
        {
          path: "/intro.md",
          content: "hi",
          action: "update" as const,
        },
      ],
    };
    const result = await wikisApi.commit("wiki-1", dto);
    expect(mockHttp.post).toHaveBeenCalledWith("/v1/wikis/wiki-1/commit", dto);
    expect(result).toEqual(fakeCommit);
  });

  it("listProposals() without status sends no params", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeProposals });
    await wikisApi.listProposals("wiki-1");
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/proposals",
      undefined,
    );
  });

  it("listProposals() with status sends it as query param", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: fakeProposals });
    await wikisApi.listProposals("wiki-1", "pending");
    expect(mockHttp.get).toHaveBeenCalledWith("/v1/wikis/wiki-1/proposals", {
      params: { status: "pending" },
    });
  });

  it("approveProposal() POSTs an empty body to the approve endpoint", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: null });
    await wikisApi.approveProposal("wiki-1", "p-1");
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/proposals/p-1/approve",
      {},
    );
  });

  it("rejectProposal() POSTs an empty body without reason", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: null });
    await wikisApi.rejectProposal("wiki-1", "p-1");
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/proposals/p-1/reject",
      {},
    );
  });

  it("rejectProposal() POSTs the reason when provided", async () => {
    mockHttp.post.mockResolvedValueOnce({ data: null });
    await wikisApi.rejectProposal("wiki-1", "p-1", "nope");
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/wikis/wiki-1/proposals/p-1/reject",
      { reason: "nope" },
    );
  });
});
