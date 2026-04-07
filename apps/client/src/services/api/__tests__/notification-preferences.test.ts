import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

import { getPreferences, updatePreferences } from "../notification-preferences";

const defaultPreferences = {
  mentionsEnabled: true,
  repliesEnabled: true,
  dmsEnabled: true,
  systemEnabled: true,
  workspaceEnabled: true,
  desktopEnabled: false,
  soundEnabled: true,
  dndEnabled: false,
  dndStart: null,
  dndEnd: null,
};

describe("notification-preferences API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPreferences", () => {
    it("fetches notification preferences", async () => {
      mockHttp.get.mockResolvedValue({ data: defaultPreferences });

      const result = await getPreferences();

      expect(mockHttp.get).toHaveBeenCalledWith("/v1/notification-preferences");
      expect(result).toEqual(defaultPreferences);
    });

    it("propagates errors from http client", async () => {
      const error = new Error("Unauthorized");
      mockHttp.get.mockRejectedValue(error);

      await expect(getPreferences()).rejects.toThrow("Unauthorized");
    });
  });

  describe("updatePreferences", () => {
    it("sends partial update to server", async () => {
      const updated = { ...defaultPreferences, soundEnabled: false };
      mockHttp.patch.mockResolvedValue({ data: updated });

      const result = await updatePreferences({ soundEnabled: false });

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/v1/notification-preferences",
        { soundEnabled: false },
      );
      expect(result).toEqual(updated);
    });

    it("sends multiple fields in a single update", async () => {
      const dto = {
        dndEnabled: true,
        dndStart: "22:00",
        dndEnd: "07:00",
      };
      const updated = { ...defaultPreferences, ...dto };
      mockHttp.patch.mockResolvedValue({ data: updated });

      const result = await updatePreferences(dto);

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/v1/notification-preferences",
        dto,
      );
      expect(result).toEqual(updated);
    });

    it("sends null values for dndStart and dndEnd", async () => {
      const dto = { dndStart: null, dndEnd: null };
      const updated = { ...defaultPreferences, ...dto };
      mockHttp.patch.mockResolvedValue({ data: updated });

      const result = await updatePreferences(dto);

      expect(mockHttp.patch).toHaveBeenCalledWith(
        "/v1/notification-preferences",
        dto,
      );
      expect(result).toEqual(updated);
    });

    it("propagates errors from http client", async () => {
      const error = new Error("Server error");
      mockHttp.patch.mockRejectedValue(error);

      await expect(updatePreferences({ soundEnabled: false })).rejects.toThrow(
        "Server error",
      );
    });
  });
});
