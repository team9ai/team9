import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAuthToken,
  getRefreshToken,
  hasStoredAuthSession,
  setAuthTokens,
  clearAuthTokens,
  redirectToLogin,
  refreshAccessToken,
  getValidAccessToken,
  isAuthTokenExpired,
} from "../auth-session";

// Build a minimal JWT with a given payload (no real signature needed).
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake`;
}

function makeValidJwt(expiresInSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return makeJwt({ sub: "user-1", exp });
}

function makeExpiredJwt(): string {
  const exp = Math.floor(Date.now() / 1000) - 60;
  return makeJwt({ sub: "user-1", exp });
}

// ── Token CRUD ──────────────────────────────────────────────

describe("token CRUD", () => {
  it("getAuthToken returns null when nothing stored", () => {
    expect(getAuthToken()).toBeNull();
  });

  it("getRefreshToken returns null when nothing stored", () => {
    expect(getRefreshToken()).toBeNull();
  });

  it("setAuthTokens stores both tokens", () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    expect(getAuthToken()).toBe("at");
    expect(getRefreshToken()).toBe("rt");
  });

  it("clearAuthTokens removes both tokens", () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    clearAuthTokens();
    expect(getAuthToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("hasStoredAuthSession returns false when empty", () => {
    expect(hasStoredAuthSession()).toBe(false);
  });

  it("hasStoredAuthSession returns true when access token exists", () => {
    localStorage.setItem("auth_token", "x");
    expect(hasStoredAuthSession()).toBe(true);
  });

  it("hasStoredAuthSession returns true when only refresh token exists", () => {
    localStorage.setItem("refresh_token", "x");
    expect(hasStoredAuthSession()).toBe(true);
  });
});

// ── isAuthTokenExpired ──────────────────────────────────────

describe("isAuthTokenExpired", () => {
  it("returns true when no token is stored", () => {
    expect(isAuthTokenExpired()).toBe(true);
  });

  it("returns false for a token that expires far in the future", () => {
    expect(isAuthTokenExpired(makeValidJwt(7200))).toBe(false);
  });

  it("returns true for an already-expired token", () => {
    expect(isAuthTokenExpired(makeExpiredJwt())).toBe(true);
  });

  it("returns true when token expires within skew window", () => {
    // Expires in 10 seconds, but default skew is 30 seconds
    expect(isAuthTokenExpired(makeValidJwt(10))).toBe(true);
  });

  it("returns true for a token with no exp claim", () => {
    expect(isAuthTokenExpired(makeJwt({ sub: "user-1" }))).toBe(true);
  });

  it("returns true for a malformed token", () => {
    expect(isAuthTokenExpired("not-a-jwt")).toBe(true);
  });
});

// ── redirectToLogin ─────────────────────────────────────────

describe("redirectToLogin", () => {
  let originalPathname: string;
  let hrefSetter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalPathname = window.location.pathname;
    // window.location.href assignment triggers navigation; spy on it.
    hrefSetter = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/dashboard", href: "" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.location, "href", {
      set: hrefSetter,
      get: () => "",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: originalPathname },
      writable: true,
      configurable: true,
    });
  });

  it("clears tokens and redirects to /login", () => {
    setAuthTokens({ accessToken: "at", refreshToken: "rt" });
    redirectToLogin();
    expect(getAuthToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(hrefSetter).toHaveBeenCalledWith("/login");
  });

  it("does not redirect when already on /login", () => {
    window.location.pathname = "/login";
    redirectToLogin();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it("does not redirect when on /register", () => {
    window.location.pathname = "/register";
    redirectToLogin();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it("does not redirect when on /verify-email", () => {
    window.location.pathname = "/verify-email/some-token";
    redirectToLogin();
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});

// ── refreshAccessToken ──────────────────────────────────────

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when no refresh token is stored", async () => {
    const result = await refreshAccessToken();
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls /v1/auth/refresh and stores new tokens on success", async () => {
    localStorage.setItem("refresh_token", "old-rt");

    const newAccessToken = makeValidJwt();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: newAccessToken,
          refreshToken: "new-rt",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await refreshAccessToken();

    expect(result).toBe(newAccessToken);
    expect(getAuthToken()).toBe(newAccessToken);
    expect(getRefreshToken()).toBe("new-rt");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/auth/refresh"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null when server responds with error", async () => {
    localStorage.setItem("refresh_token", "old-rt");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const result = await refreshAccessToken();
    expect(result).toBeNull();
  });

  it("returns null when response has invalid shape", async () => {
    localStorage.setItem("refresh_token", "old-rt");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await refreshAccessToken();
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error)", async () => {
    localStorage.setItem("refresh_token", "old-rt");

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Network error"));

    const result = await refreshAccessToken();
    expect(result).toBeNull();
  });

  it("deduplicates concurrent refresh calls", async () => {
    localStorage.setItem("refresh_token", "old-rt");

    const newAccessToken = makeValidJwt();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: newAccessToken,
          refreshToken: "new-rt",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const [r1, r2, r3] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(r1).toBe(newAccessToken);
    expect(r2).toBe(newAccessToken);
    expect(r3).toBe(newAccessToken);
    // Only one fetch call despite three concurrent refreshes
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ── getValidAccessToken ─────────────────────────────────────

describe("getValidAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns stored token when it is still valid", async () => {
    const token = makeValidJwt(3600);
    setAuthTokens({ accessToken: token, refreshToken: "rt" });

    const result = await getValidAccessToken();
    expect(result).toBe(token);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes when the stored token is expired", async () => {
    const expired = makeExpiredJwt();
    setAuthTokens({ accessToken: expired, refreshToken: "old-rt" });

    const newToken = makeValidJwt();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessToken: newToken, refreshToken: "new-rt" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getValidAccessToken();
    expect(result).toBe(newToken);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes when forceRefresh is true even if token is valid", async () => {
    const valid = makeValidJwt(3600);
    setAuthTokens({ accessToken: valid, refreshToken: "old-rt" });

    const newToken = makeValidJwt();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ accessToken: newToken, refreshToken: "new-rt" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getValidAccessToken({ forceRefresh: true });
    expect(result).toBe(newToken);
  });

  it("returns null when no tokens are stored", async () => {
    const result = await getValidAccessToken();
    expect(result).toBeNull();
  });
});
