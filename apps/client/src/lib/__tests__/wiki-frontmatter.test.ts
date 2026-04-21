import { describe, expect, it } from "vitest";
import {
  FrontmatterParseError,
  parseFrontmatter,
  serializeFrontmatter,
  type ParsedPage,
} from "../wiki-frontmatter";

// Fixtures shared with the gateway-side spec
// (apps/server/apps/gateway/src/wikis/__tests__/frontmatter.spec.ts). Any
// behavioural drift between the two implementations will fail one side.
//
// Path from apps/client/src/lib/__tests__/wiki-frontmatter.test.ts:
//   ../../../..  -> apps/
//   server/libs/shared/test-fixtures/wiki-frontmatter/  -> shared fixtures.
import basicMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/basic.md?raw";
import emptyBodyMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/empty-body.md?raw";
import noFrontmatterMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/no-frontmatter.md?raw";
import unknownKeysMd from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/unknown-keys.md?raw";
import expected from "../../../../server/libs/shared/test-fixtures/wiki-frontmatter/fixtures.json";

type FixtureExpectation = {
  frontmatter: Record<string, unknown>;
  body: string;
};

const FIXTURES: Record<
  string,
  { source: string; expected: FixtureExpectation }
> = {
  "basic.md": {
    source: basicMd,
    expected: (expected as Record<string, FixtureExpectation>)["basic.md"],
  },
  "no-frontmatter.md": {
    source: noFrontmatterMd,
    expected: (expected as Record<string, FixtureExpectation>)[
      "no-frontmatter.md"
    ],
  },
  "unknown-keys.md": {
    source: unknownKeysMd,
    expected: (expected as Record<string, FixtureExpectation>)[
      "unknown-keys.md"
    ],
  },
  "empty-body.md": {
    source: emptyBodyMd,
    expected: (expected as Record<string, FixtureExpectation>)["empty-body.md"],
  },
};

describe("wiki-frontmatter util", () => {
  describe("fixtures", () => {
    for (const [name, { source, expected: want }] of Object.entries(FIXTURES)) {
      it(`parses ${name}`, () => {
        const result = parseFrontmatter(source);
        expect(result.frontmatter).toEqual(want.frontmatter);
        expect(result.body).toBe(want.body);
      });

      it(`round-trips ${name}`, () => {
        const parsed = parseFrontmatter(source);
        const serialized = serializeFrontmatter(parsed);
        const reparsed = parseFrontmatter(serialized);
        expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
        expect(reparsed.body).toBe(parsed.body);
      });
    }
  });

  describe("parseFrontmatter", () => {
    it("returns empty frontmatter and original body when no opening fence", () => {
      const source = "# Hello\n\nNo frontmatter.\n";
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(source);
    });

    it("treats an opening fence with no closing fence as no frontmatter", () => {
      const source = '---\nicon: "📘"\n\nbody without close fence';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(source);
    });

    it("handles an empty frontmatter block (---\\n---)", () => {
      const source = "---\n---\n\nhello\n";
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("hello\n");
    });

    it("handles an empty frontmatter block followed immediately by EOF", () => {
      const source = "---\n---";
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("");
    });

    it("handles CRLF line endings", () => {
      const source =
        '---\r\nicon: "📘"\r\ntitle: "Welcome"\r\n---\r\n\r\nbody\r\n';
      const result = parseFrontmatter(source);
      expect(result.frontmatter).toEqual({ icon: "📘", title: "Welcome" });
      expect(result.body).toBe("body\r\n");
    });

    it("throws FrontmatterParseError on malformed YAML", () => {
      const source = '---\nicon: "📘\n---\n\nbody';
      expect(() => parseFrontmatter(source)).toThrow(FrontmatterParseError);
    });

    it("exposes the underlying cause on FrontmatterParseError for malformed YAML", () => {
      const source = '---\nicon: "📘\n---\n\nbody';
      try {
        parseFrontmatter(source);
        throw new Error("expected parseFrontmatter to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(FrontmatterParseError);
        expect((err as FrontmatterParseError).cause).toBeDefined();
      }
    });

    it("throws FrontmatterParseError when frontmatter is a YAML list at top level", () => {
      const source = "---\n- one\n- two\n---\n\nbody\n";
      expect(() => parseFrontmatter(source)).toThrow(FrontmatterParseError);
      expect(() => parseFrontmatter(source)).toThrow(
        /mapping at the top level/,
      );
    });

    it("throws FrontmatterParseError when frontmatter is a scalar (number)", () => {
      const source = "---\n42\n---\n\nbody\n";
      try {
        parseFrontmatter(source);
        throw new Error("expected parseFrontmatter to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(FrontmatterParseError);
        expect((err as FrontmatterParseError).cause).toBe(42);
      }
    });
  });

  describe("serializeFrontmatter", () => {
    it("returns just the body when frontmatter is empty", () => {
      const out = serializeFrontmatter({ frontmatter: {}, body: "hello" });
      expect(out).toBe("hello");
    });

    it("emits fences and YAML when frontmatter is present", () => {
      const page: ParsedPage = {
        frontmatter: { icon: "📘", title: "Welcome" },
        body: "# Welcome\n",
      };
      const out = serializeFrontmatter(page);
      expect(out.startsWith("---\n")).toBe(true);
      expect(out).toContain("icon: 📘");
      expect(out).toContain("title: Welcome");
      expect(out).toContain("---\n\n# Welcome\n");
    });

    it("preserves unknown frontmatter keys on serialize", () => {
      const page: ParsedPage = {
        frontmatter: { custom: "value", nested: { foo: "bar" } },
        body: "hello",
      };
      const out = serializeFrontmatter(page);
      expect(out).toContain("custom: value");
      expect(out).toContain("nested:");
      expect(out).toContain("foo: bar");
    });

    it("round-trips unknown keys through parse -> serialize -> parse", () => {
      const original: ParsedPage = {
        frontmatter: {
          icon: "📘",
          customField: { nested: "value", list: [1, 2, 3] },
          anotherKey: 42,
        },
        body: "Body text.\n",
      };
      const serialized = serializeFrontmatter(original);
      const reparsed = parseFrontmatter(serialized);
      expect(reparsed.frontmatter).toEqual(original.frontmatter);
      expect(reparsed.body).toBe(original.body);
    });
  });

  describe("FrontmatterParseError", () => {
    it("has the correct name", () => {
      const err = new FrontmatterParseError("boom", null);
      expect(err.name).toBe("FrontmatterParseError");
      expect(err.message).toBe("boom");
      expect(err.cause).toBeNull();
      expect(err).toBeInstanceOf(Error);
    });
  });
});
