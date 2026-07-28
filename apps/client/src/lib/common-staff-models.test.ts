import { describe, expect, it } from "vitest";
import {
  findStaffModel,
  formatStaffModelDisplayLabel,
  getDefaultStaffModel,
  type StaffModel,
} from "./common-staff-models";

const serverModels: StaffModel[] = [
  {
    provider: "openrouter",
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    family: "anthropic",
    default: true,
  },
  {
    provider: "openrouter",
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash (Preview)",
    family: "google",
  },
];

describe("staff model presentation helpers", () => {
  it("selects the default only from the supplied server catalog", () => {
    expect(getDefaultStaffModel(serverModels)).toEqual(serverModels[0]);
  });

  it("fails closed when the server catalog has no default", () => {
    expect(() =>
      getDefaultStaffModel(serverModels.map((model) => ({ ...model }))),
    ).not.toThrow();
    expect(() =>
      getDefaultStaffModel(
        serverModels.map(({ default: _default, ...model }) => model),
      ),
    ).toThrow("Server catalog has no default model");
  });

  it("matches provider and model ID as one exact pair", () => {
    expect(
      findStaffModel(serverModels, {
        provider: "openrouter",
        id: "anthropic/claude-sonnet-4.6",
      }),
    ).toEqual(serverModels[0]);
    expect(
      findStaffModel(serverModels, {
        provider: "anthropic",
        id: "anthropic/claude-sonnet-4.6",
      }),
    ).toBeNull();
  });

  it("formats picker display labels without preview suffixes", () => {
    expect(formatStaffModelDisplayLabel("Gemini 3 Flash (Preview)")).toBe(
      "Gemini 3 Flash",
    );
    expect(formatStaffModelDisplayLabel("Claude Sonnet 4.6")).toBe(
      "Claude Sonnet 4.6",
    );
  });
});
