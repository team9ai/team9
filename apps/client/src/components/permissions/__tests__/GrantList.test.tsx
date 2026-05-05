import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Mock react-i18next ────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "grants.title": "Granted permissions",
        "grants.empty": `No grants for this ${params?.subject ?? "subject"}`,
        "grants.createButton": "Add grant",
        "grants.revoke": "Revoke",
        "grants.revokeConfirm": "Revoke this grant?",
        "grants.permissionKey": "Permission",
        "grants.scope": "Scope",
        "grants.expires": "Expires",
        "grants.createdBy": "Granted by",
        "remember.subjectLabel": "Apply to",
        "remember.subjectAgent": "This agent",
        "remember.subjectChannel": "This channel only",
        "remember.subjectExecution": "This routine run only",
        "remember.subjectTask": "This routine (all runs)",
        "remember.expiresLabel": "Expires (optional)",
        "remember.scopeLabel": "Scope",
        "remember.save": "Save grant",
      };
      return map[key] ?? key;
    },
  }),
}));

// ── Mock permissions API ──────────────────────────────────────────────────────
const mockListGrants = vi.hoisted(() => vi.fn().mockResolvedValue([]));

const mockCreateGrant = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "g-new" }),
);

const mockRevokeGrant = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/services/api/permissions", () => ({
  default: {
    listGrants: mockListGrants,
    createGrant: mockCreateGrant,
    revokeGrant: mockRevokeGrant,
  },
}));

// ── Mock useCreateGrant so we can spy on mutateAsync ─────────────────────────
const mockMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "g-new" }),
);

vi.mock("@/hooks/usePermissions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/usePermissions")>();
  return {
    ...actual,
    useCreateGrant: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    }),
  };
});

// ── Import under test (after mocks) ──────────────────────────────────────────
import { GrantList } from "../GrantList";

// ── Test wrapper ─────────────────────────────────────────────────────────────
function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const SAMPLE_GRANTS = [
  {
    id: "g1",
    subjectKind: "agent" as const,
    subjectId: "bot-1",
    permissionKey: "messages:send",
    scopeMetadata: { channelIds: ["c1", "c2"] },
    expiresAt: "2030-01-01T00:00:00.000Z",
    revokedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "g2",
    subjectKind: "agent" as const,
    subjectId: "bot-1",
    permissionKey: "wiki:read",
    scopeMetadata: { wikiId: "w1" },
    expiresAt: null,
    revokedAt: null,
    createdAt: "2024-02-01T00:00:00.000Z",
  },
];

describe("<GrantList>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListGrants.mockResolvedValue([]);
    mockCreateGrant.mockResolvedValue({ id: "g-new" });
    mockRevokeGrant.mockResolvedValue(undefined);
  });

  // ── Test 1: empty state ──────────────────────────────────────────────────
  it("shows empty state when there are no grants", async () => {
    mockListGrants.mockResolvedValueOnce([]);
    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    expect(await screen.findByText(/no grants for this/i)).toBeInTheDocument();
  });

  // ── Test 2: list rendering ───────────────────────────────────────────────
  it("renders rows for each grant including permission key and revoke button", async () => {
    mockListGrants.mockResolvedValueOnce(SAMPLE_GRANTS);
    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    expect(await screen.findByText("messages:send")).toBeInTheDocument();
    expect(screen.getByText("wiki:read")).toBeInTheDocument();
    // Both rows should have a revoke button
    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    expect(revokeButtons).toHaveLength(2);
  });

  // ── Test 3: revoke flow ──────────────────────────────────────────────────
  it("calls revokeGrant after user confirms revoke", async () => {
    mockListGrants.mockResolvedValueOnce(SAMPLE_GRANTS);
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText("messages:send");

    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    await waitFor(() => {
      expect(mockRevokeGrant).toHaveBeenCalledWith("g1");
    });
  });

  // ── Test 4: revoke cancelled ─────────────────────────────────────────────
  it("does not call revokeGrant when user cancels the confirm dialog", async () => {
    mockListGrants.mockResolvedValueOnce(SAMPLE_GRANTS);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText("messages:send");

    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    expect(mockRevokeGrant).not.toHaveBeenCalled();
  });

  // ── Test 5: "Add grant" button opens editor dialog ───────────────────────
  it('renders an "Add grant" button', async () => {
    mockListGrants.mockResolvedValueOnce([]);
    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText(/no grants for this/i);
    expect(
      screen.getByRole("button", { name: /add grant/i }),
    ).toBeInTheDocument();
  });

  // ── Test 6: scope summary displayed ─────────────────────────────────────
  it("displays a scope summary for each grant", async () => {
    mockListGrants.mockResolvedValueOnce(SAMPLE_GRANTS);
    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText("messages:send");
    // scope summary for g1 should mention the channelIds
    expect(screen.getByText(/c1/)).toBeInTheDocument();
  });

  // ── GrantEditor dialog tests ─────────────────────────────────────────────

  it('opens GrantEditor dialog when "Add grant" is clicked', async () => {
    mockListGrants.mockResolvedValueOnce([]);
    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText(/no grants for this/i);

    const addButton = screen.getByRole("button", { name: /add grant/i });
    await act(async () => {
      fireEvent.click(addButton);
    });

    // The GrantEditor dialog should now be open (role=dialog)
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("submits create grant on save with the correct body", async () => {
    mockListGrants.mockResolvedValueOnce([]);
    mockMutateAsync.mockClear();

    render(wrap(<GrantList subjectKind="agent" subjectId="bot-1" />));
    await screen.findByText(/no grants for this/i);

    // Open the dialog
    const addButton = screen.getByRole("button", { name: /add grant/i });
    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // Click Save grant (default permissionKey is first in PERMISSION_KEYS)
    const saveButton = screen.getByRole("button", { name: /save grant/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectKind: "agent",
          subjectId: "bot-1",
          permissionKey: "messages:send",
        }),
      );
    });
  });
});
