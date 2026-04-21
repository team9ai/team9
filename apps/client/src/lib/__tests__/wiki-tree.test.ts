import { describe, expect, it } from "vitest";
import { buildTree } from "../wiki-tree";
import type { TreeEntryDto } from "@/types/wiki";

/**
 * Tree-util coverage — the rest of the wiki sidebar stack relies on this
 * transform being correct, so we exercise the edge cases that actually
 * matter (filtering, deep nesting, sort order) rather than just the happy
 * path.
 */

function file(path: string, size = 0): TreeEntryDto {
  return { name: path.split("/").pop() ?? path, path, type: "file", size };
}

function dir(path: string): TreeEntryDto {
  return { name: path.split("/").pop() ?? path, path, type: "dir", size: 0 };
}

describe("buildTree", () => {
  it("returns [] for empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("returns a single file at the root", () => {
    expect(buildTree([file("a.md")])).toEqual([
      { name: "a.md", path: "a.md", type: "file", children: [] },
    ]);
  });

  it("nests a deep path into dir → dir → file", () => {
    expect(buildTree([file("api/v1/auth.md")])).toEqual([
      {
        name: "api",
        path: "api",
        type: "dir",
        children: [
          {
            name: "v1",
            path: "api/v1",
            type: "dir",
            children: [
              {
                name: "auth.md",
                path: "api/v1/auth.md",
                type: "file",
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("puts directories before files at the same level", () => {
    const result = buildTree([file("a.md"), file("z/b.md")]);
    expect(result.map((n) => ({ type: n.type, name: n.name }))).toEqual([
      { type: "dir", name: "z" },
      { type: "file", name: "a.md" },
    ]);
  });

  it("puts directories before files regardless of input order (interleaved)", () => {
    // A large mixed set forces the comparator to hit both legs of the
    // `a.type === 'dir' ? -1 : 1` ternary across successive comparisons.
    const result = buildTree([
      file("a.md"),
      file("z/x.md"),
      file("b.md"),
      file("m/x.md"),
      file("c.md"),
    ]);
    expect(result.map((n) => ({ type: n.type, name: n.name }))).toEqual([
      { type: "dir", name: "m" },
      { type: "dir", name: "z" },
      { type: "file", name: "a.md" },
      { type: "file", name: "b.md" },
      { type: "file", name: "c.md" },
    ]);
  });

  it("sorts files alphabetically within a level", () => {
    const result = buildTree([file("z.md"), file("a.md"), file("m.md")]);
    expect(result.map((n) => n.name)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("sorts directories alphabetically within a level", () => {
    const result = buildTree([
      file("zeta/x.md"),
      file("alpha/x.md"),
      file("mike/x.md"),
    ]);
    expect(result.map((n) => n.name)).toEqual(["alpha", "mike", "zeta"]);
  });

  it("keeps siblings in the same directory as a flat list (not re-nested)", () => {
    const result = buildTree([file("api/a.md"), file("api/b.md")]);
    expect(result).toHaveLength(1);
    expect(result[0].children.map((c) => c.name)).toEqual(["a.md", "b.md"]);
  });

  it("filters out paths whose root segment starts with a dot", () => {
    expect(buildTree([file(".team9/covers/x.jpg"), file("a.md")])).toEqual([
      { name: "a.md", path: "a.md", type: "file", children: [] },
    ]);
  });

  it("filters out entries with a dot-prefixed segment at any depth", () => {
    const result = buildTree([
      file("foo/.bar/baz.md"),
      file("foo/ok.md"),
      file("foo/.cache/deep/very/x.md"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("foo");
    expect(result[0].children.map((c) => c.path)).toEqual(["foo/ok.md"]);
  });

  it("skips non-file entries defensively (folder9 recursive shouldn't emit them)", () => {
    const result = buildTree([dir("just-a-dir"), file("a.md")]);
    expect(result.map((n) => n.name)).toEqual(["a.md"]);
  });

  it("skips entries with an empty-string path", () => {
    // folder9 should never emit these, but an empty path would otherwise
    // split to `[""]` and surface as a file with an empty name at the root.
    const result = buildTree([file(""), file("a.md")]);
    expect(result.map((n) => n.name)).toEqual(["a.md"]);
  });

  it("skips entries whose path ends with a slash", () => {
    // A trailing slash would otherwise create a real dir node containing a
    // phantom empty-named file — corrupting the tree shape.
    const result = buildTree([file("api/"), file("a.md")]);
    expect(result.map((n) => n.name)).toEqual(["a.md"]);
  });

  it("skips entries with a doubled-slash path", () => {
    // `api//auth.md` would split to ["api", "", "auth.md"], creating an
    // intermediate dir with an empty name. Guard defensively instead.
    const result = buildTree([file("api//auth.md"), file("a.md")]);
    expect(result.map((n) => n.name)).toEqual(["a.md"]);
  });

  it("handles a mixed realistic payload end-to-end", () => {
    const entries: TreeEntryDto[] = [
      file("index.md"),
      file("api/auth.md"),
      file("api/webhooks.md"),
      file(".team9/covers/x.jpg"),
      file("api/v2/legacy.md"),
    ];
    const result = buildTree(entries);

    // Top level: dir `api` first, then file `index.md`
    expect(result.map((n) => ({ type: n.type, name: n.name }))).toEqual([
      { type: "dir", name: "api" },
      { type: "file", name: "index.md" },
    ]);

    const api = result[0];
    // Inside `api`: dir `v2` first, then files sorted alphabetically
    expect(api.children.map((n) => ({ type: n.type, name: n.name }))).toEqual([
      { type: "dir", name: "v2" },
      { type: "file", name: "auth.md" },
      { type: "file", name: "webhooks.md" },
    ]);
    expect(api.children[0].children[0]).toMatchObject({
      name: "legacy.md",
      path: "api/v2/legacy.md",
      type: "file",
    });
  });

  it("re-uses an existing dir node when sibling files share a parent path", () => {
    const result = buildTree([
      file("api/v1/a.md"),
      file("api/v1/b.md"),
      file("api/v2/a.md"),
    ]);
    // Single `api` at the top
    expect(result).toHaveLength(1);
    expect(result[0].children.map((c) => c.name)).toEqual(["v1", "v2"]);
    expect(result[0].children[0].children.map((c) => c.name)).toEqual([
      "a.md",
      "b.md",
    ]);
  });
});
