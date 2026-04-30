import { describe, expect, it } from "vitest";
import { buildFolderTree } from "../folder-tree";
import type { TreeEntryDto } from "@/services/api/folder9-folder";

function file(path: string): TreeEntryDto {
  return {
    name: path.split("/").pop()!,
    path,
    type: "file",
    size: 1,
  };
}

describe("buildFolderTree", () => {
  it("builds a flat list at root", () => {
    const tree = buildFolderTree([file("a.md"), file("b.md")]);
    expect(tree.map((n) => n.path)).toEqual(["a.md", "b.md"]);
    expect(tree.every((n) => n.type === "file")).toBe(true);
  });

  it("derives directory nodes from file path segments", () => {
    const tree = buildFolderTree([file("api/auth.md"), file("api/users.md")]);
    expect(tree).toHaveLength(1);
    const apiDir = tree[0];
    expect(apiDir).toMatchObject({ name: "api", path: "api", type: "dir" });
    expect(apiDir.children.map((c) => c.path)).toEqual([
      "api/auth.md",
      "api/users.md",
    ]);
  });

  it("sorts directories before files at every level", () => {
    const tree = buildFolderTree([
      file("z.md"),
      file("a.md"),
      file("api/x.md"),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["api", "a.md", "z.md"]);
  });

  it("sorts alphabetically within the same type", () => {
    const tree = buildFolderTree([file("c.md"), file("a.md"), file("b.md")]);
    expect(tree.map((n) => n.name)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("filters dot-prefixed paths at any depth", () => {
    const tree = buildFolderTree([
      file(".team9/index.md"),
      file("foo/.cache/x.md"),
      file("real.md"),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["real.md"]);
  });

  it("skips non-file entries", () => {
    const tree = buildFolderTree([
      { name: "scripts", path: "scripts", type: "dir", size: 0 },
      file("scripts/x.sh"),
    ]);
    // `scripts` dir is derived from the file's path, NOT from the
    // dir entry (which is skipped).
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("scripts");
    expect(tree[0].type).toBe("dir");
  });

  it("skips empty / trailing-slash / doubled-slash paths", () => {
    const tree = buildFolderTree([
      { name: "", path: "", type: "file", size: 0 },
      { name: "x", path: "foo/", type: "file", size: 0 },
      { name: "x", path: "foo//bar.md", type: "file", size: 0 },
      file("ok.md"),
    ]);
    expect(tree.map((n) => n.path)).toEqual(["ok.md"]);
  });

  it("overwrites duplicate file entries (defensive)", () => {
    const tree = buildFolderTree([file("a.md"), file("a.md")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe("a.md");
  });

  it("returns an empty array for an empty entry list", () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});
