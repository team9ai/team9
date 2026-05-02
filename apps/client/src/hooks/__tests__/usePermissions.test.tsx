import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  usePendingPermissionRequests,
  useDecidePermission,
  useGrants,
  useCreateGrant,
  useRevokeGrant,
} from "../usePermissions";
import type { PermissionRequest, PermissionGrant } from "../usePermissions";

// ── Mock the permissions API module ─────────────────────────────────────────

const mockListRequests = vi.hoisted(() => vi.fn());
const mockDecideRequest = vi.hoisted(() => vi.fn());
const mockListGrants = vi.hoisted(() => vi.fn());
const mockCreateGrant = vi.hoisted(() => vi.fn());
const mockRevokeGrant = vi.hoisted(() => vi.fn());

vi.mock("@/services/api/permissions", () => ({
  default: {
    listRequests: mockListRequests,
    decideRequest: mockDecideRequest,
    listGrants: mockListGrants,
    createGrant: mockCreateGrant,
    revokeGrant: mockRevokeGrant,
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function makeWrapper(qc = makeClient()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper: Wrapper, qc };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const pendingRequest: PermissionRequest = {
  id: "r1",
  spellId: "spell-abc",
  permissionKey: "tools:invoke",
  requestedMetadata: {},
  reason: null,
  contextChannelId: null,
  expiresAt: "2099-01-01T00:00:00.000Z",
  status: "pending",
  requesterBotId: "bot-1",
};

const sampleGrant: PermissionGrant = {
  id: "g1",
  subjectKind: "agent",
  subjectId: "agent-1",
  permissionKey: "tools:invoke",
  scopeMetadata: {},
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── usePendingPermissionRequests ──────────────────────────────────────────

  describe("usePendingPermissionRequests", () => {
    it("fetches /permissions/requests with status=pending&scope=mine", async () => {
      mockListRequests.mockResolvedValueOnce([pendingRequest]);
      const { wrapper } = makeWrapper();

      const { result } = renderHook(() => usePendingPermissionRequests(), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockListRequests).toHaveBeenCalledWith({
        status: "pending",
        scope: "mine",
      });
      expect(result.current.data).toEqual([pendingRequest]);
    });

    it("returns empty array when no requests", async () => {
      mockListRequests.mockResolvedValueOnce([]);
      const { wrapper } = makeWrapper();

      const { result } = renderHook(() => usePendingPermissionRequests(), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it("surfaces API errors", async () => {
      mockListRequests.mockRejectedValueOnce(new Error("Unauthorized"));
      const { wrapper } = makeWrapper();

      const { result } = renderHook(() => usePendingPermissionRequests(), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  // ── useDecidePermission ───────────────────────────────────────────────────

  describe("useDecidePermission", () => {
    it("posts to /permissions/requests/:id/decide and invalidates list", async () => {
      mockDecideRequest.mockResolvedValueOnce({
        ...pendingRequest,
        status: "approved_once",
      });
      const { wrapper, qc } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useDecidePermission(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          requestId: "r1",
          decision: "once",
        });
      });

      expect(mockDecideRequest).toHaveBeenCalledWith({
        requestId: "r1",
        decision: "once",
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["permissions", "requests"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["permissions", "grants"],
      });
    });

    it("surfaces mutation errors", async () => {
      mockDecideRequest.mockRejectedValueOnce(new Error("Not found"));
      const { wrapper } = makeWrapper();

      const { result } = renderHook(() => useDecidePermission(), { wrapper });

      await expect(
        act(async () => {
          await result.current.mutateAsync({
            requestId: "r1",
            decision: "deny",
          });
        }),
      ).rejects.toThrow("Not found");
    });
  });

  // ── useGrants ────────────────────────────────────────────────────────────

  describe("useGrants", () => {
    it("fetches grants for a given subject", async () => {
      mockListGrants.mockResolvedValueOnce([sampleGrant]);
      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () => useGrants({ subjectKind: "agent", subjectId: "agent-1" }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockListGrants).toHaveBeenCalledWith({
        subjectKind: "agent",
        subjectId: "agent-1",
      });
      expect(result.current.data).toEqual([sampleGrant]);
    });

    it("returns empty array when no grants", async () => {
      mockListGrants.mockResolvedValueOnce([]);
      const { wrapper } = makeWrapper();

      const { result } = renderHook(
        () => useGrants({ subjectKind: "agent", subjectId: "agent-2" }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  // ── useCreateGrant ────────────────────────────────────────────────────────

  describe("useCreateGrant", () => {
    it("calls createGrant and invalidates grants", async () => {
      mockCreateGrant.mockResolvedValueOnce(sampleGrant);
      const { wrapper, qc } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useCreateGrant(), { wrapper });

      const payload: Omit<PermissionGrant, "id" | "revokedAt" | "createdAt"> = {
        subjectKind: "agent",
        subjectId: "agent-1",
        permissionKey: "tools:invoke",
        scopeMetadata: {},
        expiresAt: null,
      };

      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockCreateGrant).toHaveBeenCalledWith(payload);
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["permissions", "grants"],
      });
    });
  });

  // ── useRevokeGrant ────────────────────────────────────────────────────────

  describe("useRevokeGrant", () => {
    it("calls revokeGrant and invalidates grants", async () => {
      mockRevokeGrant.mockResolvedValueOnce(undefined);
      const { wrapper, qc } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useRevokeGrant(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync("g1");
      });

      expect(mockRevokeGrant).toHaveBeenCalledWith("g1");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["permissions", "grants"],
      });
    });
  });
});
