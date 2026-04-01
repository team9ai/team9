import { describe, expect, it } from "vitest";
import {
  isRestorableSectionPath,
  sanitizeLastVisitedPaths,
} from "../useAppStore";

describe("useAppStore navigation helpers", () => {
  it("rejects utility routes from last-visited restore", () => {
    expect(isRestorableSectionPath("/profile")).toBe(false);
    expect(isRestorableSectionPath("/search?q=test")).toBe(false);
    expect(isRestorableSectionPath("/")).toBe(false);
    expect(isRestorableSectionPath("/more")).toBe(true);
  });

  it("clears polluted persisted paths while preserving section pages", () => {
    expect(
      sanitizeLastVisitedPaths({
        home: "/profile",
        messages: "/messages/dm-1",
        more: "/search?q=docs",
      }),
    ).toMatchObject({
      home: null,
      messages: "/messages/dm-1",
      more: null,
    });
  });
});
