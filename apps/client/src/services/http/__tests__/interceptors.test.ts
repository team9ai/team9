import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HttpError, HttpRequestConfig } from "../types";

// Mock auth-session before importing interceptors so module-level
// import picks up the mocks.
vi.mock("../../auth-session", () => ({
  getAuthToken: vi.fn(() => null),
  redirectToLogin: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

// Mock workspace store
vi.mock("../../../stores", () => ({
  useWorkspaceStore: { getState: () => ({ selectedWorkspaceId: null }) },
}));

// Mock Sentry
vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
}));

import { authInterceptor, handleUnauthorized } from "../interceptors";
import {
  getAuthToken,
  redirectToLogin,
  refreshAccessToken,
} from "../../auth-session";

function makeError(
  status: number,
  config?: Partial<HttpRequestConfig>,
): HttpError {
  const err = new Error(`Request failed with status ${status}`) as HttpError;
  err.status = status;
  err.config = { url: "/v1/some-endpoint", method: "GET", ...config };
  return err;
}

// ── authInterceptor ─────────────────────────────────────────

describe("authInterceptor", () => {
  it("attaches Authorization header when token exists", () => {
    vi.mocked(getAuthToken).mockReturnValue("my-token");

    const config = authInterceptor({ url: "/test" });

    expect(config.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer my-token" }),
    );
  });

  it("does not attach header when no token", () => {
    vi.mocked(getAuthToken).mockReturnValue(null);

    const config = authInterceptor({ url: "/test" });

    expect(config.headers?.Authorization).toBeUndefined();
  });
});

// ── handleUnauthorized ──────────────────────────────────────

describe("handleUnauthorized", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(redirectToLogin).mockReset();
    vi.mocked(refreshAccessToken).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-throws non-401 errors without refresh attempt", async () => {
    const error = makeError(500);

    await expect(handleUnauthorized(error)).rejects.toBe(error);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("redirects to login when refresh endpoint itself returns 401", async () => {
    const error = makeError(401, { url: "/v1/auth/refresh" });

    await expect(handleUnauthorized(error)).rejects.toBe(error);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("retries the original request with the new token on success", async () => {
    const newToken = "fresh-access-token";
    vi.mocked(refreshAccessToken).mockResolvedValue(newToken);

    const responsePayload = { id: 1, name: "test" };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const error = makeError(401, {
      url: "/v1/channels",
      method: "GET",
      baseURL: "http://localhost:3000/api",
    });

    const result = await handleUnauthorized(error);

    expect(result.status).toBe(200);
    expect(result.data).toEqual(responsePayload);
    // Verify the retry used the new token
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/channels"),
      expect.objectContaining({ method: "GET" }),
    );
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const headers = fetchCall[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${newToken}`);
  });

  it("redirects to login when refresh returns null", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(null);

    const error = makeError(401);

    await expect(handleUnauthorized(error)).rejects.toBe(error);
    expect(redirectToLogin).toHaveBeenCalled();
  });

  it("redirects to login when refresh throws", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new Error("network failure"),
    );

    const error = makeError(401);

    await expect(handleUnauthorized(error)).rejects.toBe(error);
    expect(redirectToLogin).toHaveBeenCalled();
  });

  it("throws original error when config is missing", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue("new-token");

    const error = makeError(401);
    error.config = undefined;

    await expect(handleUnauthorized(error)).rejects.toBe(error);
  });
});
