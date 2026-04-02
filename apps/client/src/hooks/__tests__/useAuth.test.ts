import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores";

const mockSetUser = vi.hoisted(() => vi.fn());
const mockSetQueryData = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react", () => ({
  setUser: mockSetUser,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { syncCurrentUser } from "../useAuth";

describe("syncCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
  });

  it("syncs a signed-in user to the app store, Sentry, and query cache", () => {
    const user = {
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      avatarUrl: "https://cdn.example.com/avatar.png",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    syncCurrentUser(user, { setQueryData: mockSetQueryData } as never);

    expect(mockSetQueryData).toHaveBeenCalledWith(["currentUser"], user);
    expect(useAppStore.getState().user).toEqual({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: "https://cdn.example.com/avatar.png",
      createdAt: "2026-03-31T00:00:00.000Z",
    });
    expect(mockSetUser).toHaveBeenCalledWith({
      id: "user-1",
      email: "alice@example.com",
    });
  });

  it("clears the signed-in user when null is passed", () => {
    syncCurrentUser(null, { setQueryData: mockSetQueryData } as never);

    expect(mockSetQueryData).toHaveBeenCalledWith(["currentUser"], null);
    expect(useAppStore.getState().user).toBeNull();
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });
});
