import { describe, expect, it } from "vitest";
import { resolveClientPermission } from "../wiki-permission";
import type { WikiDto } from "@/types/wiki";

const baseWiki: WikiDto = {
  id: "wiki-1",
  workspaceId: "ws-1",
  name: "Handbook",
  slug: "handbook",
  approvalMode: "auto",
  humanPermission: "write",
  agentPermission: "propose",
  createdBy: "user-1",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
};

describe("resolveClientPermission", () => {
  it("returns 'read' when user is null", () => {
    expect(resolveClientPermission(baseWiki, null)).toBe("read");
  });

  it("returns 'read' when user is undefined", () => {
    expect(resolveClientPermission(baseWiki, undefined)).toBe("read");
  });

  it("returns humanPermission for human users (userType)", () => {
    expect(resolveClientPermission(baseWiki, { userType: "human" })).toBe(
      "write",
    );
  });

  it("returns humanPermission for users without any type (defaults to human)", () => {
    expect(resolveClientPermission(baseWiki, {})).toBe("write");
  });

  it("returns agentPermission for bot users (userType)", () => {
    expect(resolveClientPermission(baseWiki, { userType: "bot" })).toBe(
      "propose",
    );
  });

  it("returns agentPermission for agent users (userType)", () => {
    expect(resolveClientPermission(baseWiki, { userType: "agent" })).toBe(
      "propose",
    );
  });

  it("treats system users as agents", () => {
    expect(resolveClientPermission(baseWiki, { userType: "system" })).toBe(
      "propose",
    );
  });

  it("accepts the legacy `type` shorthand for agent detection", () => {
    expect(resolveClientPermission(baseWiki, { type: "agent" })).toBe(
      "propose",
    );
    expect(resolveClientPermission(baseWiki, { type: "bot" })).toBe("propose");
    expect(resolveClientPermission(baseWiki, { type: "human" })).toBe("write");
  });

  it("prefers `userType` over legacy `type` when both are present", () => {
    // This is an invalid mixed shape, but guarding deterministically means
    // upgrades that start populating `userType` without immediately dropping
    // `type` still produce the right answer.
    expect(
      resolveClientPermission(baseWiki, { userType: "human", type: "bot" }),
    ).toBe("write");
  });

  it("honors distinct humanPermission / agentPermission settings", () => {
    const wiki: WikiDto = {
      ...baseWiki,
      humanPermission: "read",
      agentPermission: "write",
    };
    expect(resolveClientPermission(wiki, { userType: "human" })).toBe("read");
    expect(resolveClientPermission(wiki, { userType: "bot" })).toBe("write");
  });
});
