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
        "inbox.title": "Permission Requests",
        "inbox.empty": "No pending requests",
        "inbox.badgeAria": `${params?.count ?? 0} pending permission requests`,
        "request.from": `From ${params?.bot ?? "bot"}`,
        "request.in": `in ${params?.channel ?? ""}`,
        "request.spellCopy": "Copy spell id",
        "request.allowOnce": "Allow once",
        "request.remember": "Allow & remember…",
        "request.deny": "Deny",
        "remember.subjectLabel": "Apply to",
        "remember.subjectAgent": "This agent",
        "remember.subjectChannel": "This channel only",
        "remember.subjectExecution": "This routine run only",
        "remember.subjectTask": "This routine (all runs)",
        "remember.expiresLabel": "Expires (optional)",
        "remember.save": "Save grant",
      };
      return map[key] ?? key;
    },
  }),
}));

// ── Mock permissions API ──────────────────────────────────────────────────────
const mockListRequests = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      id: "r1",
      spellId: "raven crystal flame",
      permissionKey: "messages:send",
      requestedMetadata: { channelId: "c1" },
      reason: "reason",
      contextChannelId: "c1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "pending",
      requesterBotId: "b1",
    },
  ]),
);

const mockDecideRequest = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "r1", status: "approved_once" }),
);

vi.mock("@/services/api/permissions", () => ({
  default: {
    listRequests: mockListRequests,
    decideRequest: mockDecideRequest,
  },
}));

// ── Mock useAppStore ──────────────────────────────────────────────────────────
vi.mock("@/stores/useAppStore", () => ({
  useAppStore: (selector: (s: { pendingPermissionCount: number }) => unknown) =>
    selector({ pendingPermissionCount: 1 }),
}));

// ── Import the component under test ──────────────────────────────────────────
import { PermissionInbox } from "../PermissionInbox";

// ── Test wrapper ─────────────────────────────────────────────────────────────
function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("<PermissionInbox>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRequests.mockResolvedValue([
      {
        id: "r1",
        spellId: "raven crystal flame",
        permissionKey: "messages:send",
        requestedMetadata: { channelId: "c1" },
        reason: "reason",
        contextChannelId: "c1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "pending",
        requesterBotId: "b1",
      },
    ]);
    mockDecideRequest.mockResolvedValue({ id: "r1", status: "approved_once" });
  });

  it("renders a bell button with aria-label", () => {
    render(wrap(<PermissionInbox />));
    expect(
      screen.getByRole("button", { name: /pending permission requests/i }),
    ).toBeInTheDocument();
  });

  it("shows badge when count > 0", () => {
    render(wrap(<PermissionInbox />));
    // Badge with count=1
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens and shows pending requests", async () => {
    render(wrap(<PermissionInbox />));
    fireEvent.click(
      screen.getByRole("button", { name: /pending permission requests/i }),
    );
    expect(await screen.findByText("raven crystal flame")).toBeInTheDocument();
  });

  it("clicking allow once posts decide", async () => {
    render(wrap(<PermissionInbox />));
    fireEvent.click(
      screen.getByRole("button", { name: /pending permission requests/i }),
    );
    await screen.findByText("raven crystal flame");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    });
    await waitFor(() => {
      expect(mockDecideRequest).toHaveBeenCalledWith({
        requestId: "r1",
        decision: "once",
      });
    });
  });

  it("shows empty state when there are no pending requests", async () => {
    mockListRequests.mockResolvedValueOnce([]);
    render(wrap(<PermissionInbox />));
    fireEvent.click(
      screen.getByRole("button", { name: /pending permission requests/i }),
    );
    expect(await screen.findByText("No pending requests")).toBeInTheDocument();
  });

  it("clicking the bell button again closes the popover", async () => {
    render(wrap(<PermissionInbox />));
    const bell = screen.getByRole("button", {
      name: /pending permission requests/i,
    });
    fireEvent.click(bell);
    // Popover title is visible
    expect(await screen.findByText("Permission Requests")).toBeInTheDocument();
    // Click again to close
    fireEvent.click(bell);
    expect(screen.queryByText("Permission Requests")).not.toBeInTheDocument();
  });
});
