import { describe, expect, it } from "vitest";
import {
  AVATAR_GRADIENTS,
  getInitials,
  getSeededAvatarGradient,
} from "../avatar-colors";

describe("getSeededAvatarGradient", () => {
  it("returns the same gradient for the same seed", () => {
    const seed = "workspace-123";
    const expectedGradient = "from-lime-500 to-green-400";

    expect(getSeededAvatarGradient(seed)).toBe(expectedGradient);
    expect(getSeededAvatarGradient(`  ${seed}  `)).toBe(expectedGradient);
  });

  it("returns a gradient from the shared palette", () => {
    expect(AVATAR_GRADIENTS).toContain(
      getSeededAvatarGradient("workspace-123"),
    );
  });
});

describe("getInitials", () => {
  it('returns "A" for a single-word name', () => {
    expect(getInitials("Alice")).toBe("A");
  });

  it('returns "AS" for a multi-word name', () => {
    expect(getInitials("Alice Smith")).toBe("AS");
  });

  it("trims extra spacing before extracting initials", () => {
    expect(getInitials("  Alice   Smith  ")).toBe("AS");
  });

  it("keeps a one-word Unicode initial to a single displayed character", () => {
    expect(getInitials("ß")).toBe("S");
  });

  it('returns "?" for an empty name', () => {
    expect(getInitials("")).toBe("?");
  });

  it('returns "?" for an undefined name', () => {
    expect(getInitials(undefined)).toBe("?");
  });
});
