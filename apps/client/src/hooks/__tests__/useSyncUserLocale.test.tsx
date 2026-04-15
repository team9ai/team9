import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Mocks
//
// `useSyncUserLocale` depends on three moving parts we must stub:
//
//   1. `useCurrentUser`  — React Query hook that returns `{ data: user }`.
//      We control the user via a shared `mockUser` reference.
//
//   2. `api.im.users.updateMe` — the fire-and-forget PATCH. We install a
//      mock implementation so we can assert what payload was sent (or that
//      it was NOT sent at all when nothing changed).
//
//   3. `i18n.language` — the browser-detected language. We stub the entire
//      `@/i18n` module with a plain object exposing the `language` field.
//
// Keep the mocks above the `import` of the hook under test; vi.mock()
// calls are hoisted but the import must come AFTER vi.mock() statements
// for Vitest's module system to pick up the stubs.
// ---------------------------------------------------------------------------

type MockUser = {
  id: string;
  language?: string | null;
  timeZone?: string | null;
} | null;

const { mockUpdateMe, userRef, i18nStub } = vi.hoisted(() => ({
  mockUpdateMe: vi.fn(),
  userRef: { current: null as MockUser },
  i18nStub: { language: "en" },
}));

vi.mock("@/services/api", () => ({
  default: {
    im: {
      users: {
        updateMe: (...args: unknown[]) => mockUpdateMe(...args),
      },
    },
  },
}));

vi.mock("../useAuth", () => ({
  useCurrentUser: () => ({ data: userRef.current, isLoading: false }),
}));

vi.mock("@/i18n", () => ({
  default: i18nStub,
}));

// Intl stub: the hook reads `Intl.DateTimeFormat().resolvedOptions().timeZone`.
// We override globalThis.Intl per test to get deterministic values.
type IntlWithDateTime = {
  DateTimeFormat: () => { resolvedOptions: () => { timeZone: string } };
};
const originalIntl = globalThis.Intl;
function stubIntlTimeZone(zone: string | null) {
  (globalThis as { Intl: IntlWithDateTime }).Intl = {
    DateTimeFormat: () => ({
      resolvedOptions: () => ({ timeZone: zone ?? "" }),
    }),
  };
}

import { useSyncUserLocale } from "../useSyncUserLocale";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSyncUserLocale", () => {
  beforeEach(() => {
    mockUpdateMe.mockReset();
    mockUpdateMe.mockResolvedValue({});
    userRef.current = null;
    i18nStub.language = "en";
    stubIntlTimeZone("America/New_York");
  });

  afterEach(() => {
    (globalThis as { Intl: typeof originalIntl }).Intl = originalIntl;
  });

  it("does nothing while useCurrentUser still returns null", () => {
    userRef.current = null;
    renderHook(() => useSyncUserLocale(), { wrapper });
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("patches language and timeZone when both differ from persisted values", async () => {
    userRef.current = { id: "u1", language: null, timeZone: null };
    i18nStub.language = "zh-CN";
    stubIntlTimeZone("Asia/Shanghai");

    renderHook(() => useSyncUserLocale(), { wrapper });

    await waitFor(() => {
      expect(mockUpdateMe).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateMe).toHaveBeenCalledWith({
      language: "zh-CN",
      timeZone: "Asia/Shanghai",
    });
  });

  it("patches only language when timeZone already matches", async () => {
    userRef.current = {
      id: "u1",
      language: "en",
      timeZone: "Asia/Shanghai",
    };
    i18nStub.language = "ja";
    stubIntlTimeZone("Asia/Shanghai");

    renderHook(() => useSyncUserLocale(), { wrapper });

    await waitFor(() => {
      expect(mockUpdateMe).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateMe).toHaveBeenCalledWith({ language: "ja" });
  });

  it("patches only timeZone when language already matches", async () => {
    userRef.current = {
      id: "u1",
      language: "en",
      timeZone: "America/New_York",
    };
    i18nStub.language = "en";
    stubIntlTimeZone("Europe/London");

    renderHook(() => useSyncUserLocale(), { wrapper });

    await waitFor(() => {
      expect(mockUpdateMe).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateMe).toHaveBeenCalledWith({ timeZone: "Europe/London" });
  });

  it("does not patch when language and timeZone already match persisted values", () => {
    userRef.current = {
      id: "u1",
      language: "en",
      timeZone: "America/New_York",
    };
    i18nStub.language = "en";
    stubIntlTimeZone("America/New_York");

    renderHook(() => useSyncUserLocale(), { wrapper });
    expect(mockUpdateMe).not.toHaveBeenCalled();
  });

  it("syncs at most once per mount even if the user reference is unstable", async () => {
    userRef.current = { id: "u1", language: null, timeZone: null };
    i18nStub.language = "zh-CN";
    stubIntlTimeZone("Asia/Shanghai");

    const { rerender } = renderHook(() => useSyncUserLocale(), { wrapper });
    await waitFor(() => {
      expect(mockUpdateMe).toHaveBeenCalledTimes(1);
    });

    // Simulate a re-render with the same user — the effect should not
    // re-fire because we guard on `hasSyncedRef`.
    rerender();
    rerender();
    expect(mockUpdateMe).toHaveBeenCalledTimes(1);
  });
});
