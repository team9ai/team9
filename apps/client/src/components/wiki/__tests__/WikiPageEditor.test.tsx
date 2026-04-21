import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WikiPageEditor } from "../WikiPageEditor";
import type { PageDto, WikiDto } from "@/types/wiki";

const wiki: WikiDto = {
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

const page: PageDto = {
  path: "index.md",
  content: "body",
  frontmatter: {},
  lastCommit: null,
};

describe("WikiPageEditor (stub for Task 18)", () => {
  it("renders the stub placeholder without crashing", () => {
    render(
      <WikiPageEditor
        wikiId="wiki-1"
        path="index.md"
        serverPage={page}
        wiki={wiki}
      />,
    );
    expect(screen.getByTestId("wiki-page-editor-stub")).toHaveTextContent(
      /Editor coming soon/,
    );
  });
});
