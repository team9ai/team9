import { describe, it, expect } from "vitest";
import type { TreeNode } from "@/types/relations";
import { walkVisible } from "../TableView";

// ==================== Helpers ====================

function makeNode(
  overrides: Partial<TreeNode> & { messageId: string },
): TreeNode {
  return {
    effectiveParentId: null,
    parentSource: null,
    depth: 0,
    hasChildren: false,
    childrenLoaded: false,
    ...overrides,
  };
}

// ==================== Tests ====================

describe("walkVisible", () => {
  it("returns empty array for no nodes", () => {
    expect(walkVisible([], new Set())).toEqual([]);
  });

  it("returns all root nodes when there are no children", () => {
    const nodes = [
      makeNode({ messageId: "a" }),
      makeNode({ messageId: "b" }),
      makeNode({ messageId: "c" }),
    ];
    const result = walkVisible(nodes, new Set());
    expect(result.map((n) => n.messageId)).toEqual(["a", "b", "c"]);
  });

  it("returns only root nodes when all are collapsed", () => {
    const nodes = [
      makeNode({ messageId: "root", hasChildren: true }),
      makeNode({ messageId: "child", effectiveParentId: "root", depth: 1 }),
    ];
    // root is NOT expanded
    const result = walkVisible(nodes, new Set());
    expect(result.map((n) => n.messageId)).toEqual(["root"]);
  });

  it("includes children of expanded nodes", () => {
    const nodes = [
      makeNode({ messageId: "root", hasChildren: true }),
      makeNode({ messageId: "child", effectiveParentId: "root", depth: 1 }),
    ];
    const expanded = new Set(["root"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual(["root", "child"]);
  });

  it("does not include grandchildren when only root is expanded", () => {
    const nodes = [
      makeNode({ messageId: "root", hasChildren: true }),
      makeNode({
        messageId: "child",
        effectiveParentId: "root",
        depth: 1,
        hasChildren: true,
      }),
      makeNode({
        messageId: "grandchild",
        effectiveParentId: "child",
        depth: 2,
      }),
    ];
    const expanded = new Set(["root"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual(["root", "child"]);
  });

  it("includes grandchildren when both root and child are expanded", () => {
    const nodes = [
      makeNode({ messageId: "root", hasChildren: true }),
      makeNode({
        messageId: "child",
        effectiveParentId: "root",
        depth: 1,
        hasChildren: true,
      }),
      makeNode({
        messageId: "grandchild",
        effectiveParentId: "child",
        depth: 2,
      }),
    ];
    const expanded = new Set(["root", "child"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
  });

  it("maintains stable DFS order across siblings", () => {
    // root
    //   ├── child-a
    //   │     └── grandchild-a
    //   └── child-b
    const nodes = [
      makeNode({ messageId: "root", hasChildren: true }),
      makeNode({
        messageId: "child-a",
        effectiveParentId: "root",
        depth: 1,
        hasChildren: true,
      }),
      makeNode({
        messageId: "child-b",
        effectiveParentId: "root",
        depth: 1,
      }),
      makeNode({
        messageId: "grandchild-a",
        effectiveParentId: "child-a",
        depth: 2,
      }),
    ];
    const expanded = new Set(["root", "child-a"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual([
      "root",
      "child-a",
      "grandchild-a",
      "child-b",
    ]);
  });

  it("handles multiple root nodes each with their own subtrees", () => {
    const nodes = [
      makeNode({ messageId: "root-1", hasChildren: true }),
      makeNode({ messageId: "child-1", effectiveParentId: "root-1", depth: 1 }),
      makeNode({ messageId: "root-2", hasChildren: true }),
      makeNode({ messageId: "child-2", effectiveParentId: "root-2", depth: 1 }),
    ];
    // Only root-1 expanded
    const expanded = new Set(["root-1"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual([
      "root-1",
      "child-1",
      "root-2",
    ]);
  });

  it("handles node in expanded set that has no children in data (no-op)", () => {
    const nodes = [makeNode({ messageId: "solo" })];
    const expanded = new Set(["solo"]);
    const result = walkVisible(nodes, expanded);
    expect(result.map((n) => n.messageId)).toEqual(["solo"]);
  });

  it("returns original node references (no cloning)", () => {
    const node = makeNode({ messageId: "a" });
    const result = walkVisible([node], new Set());
    expect(result[0]).toBe(node);
  });

  it("does not mutate the expanded set", () => {
    const nodes = [makeNode({ messageId: "a", hasChildren: true })];
    const expanded = new Set(["a"]);
    walkVisible(nodes, expanded);
    expect(expanded.size).toBe(1);
  });
});
