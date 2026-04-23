/**
 * Minimal tests for DmOutboundPolicyBlock integration in CommonStaffDetailSection.
 * Verifies:
 *   - Block is rendered (hideOwnerOnly=true, so owner-only option absent).
 *   - Mentor (mentorId === currentUser.id) sees block editable.
 *   - Non-mentor sees block disabled.
 *   - Mode change triggers updateMutation.mutate({ dmOutboundPolicy: {...} }).
 *   - Default when dmOutboundPolicy is absent is same-tenant.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommonStaffBotInfo,
  InstalledApplicationWithBots,
} from "@/services/api/applications";

// --- Hoisted mocks ---
const mockMutate = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useQuery: mockUseQuery,
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "user-mentor-1" } }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Stub MemoryTab and WorkfileTab
vi.mock("@/components/ai-staff/memory/MemoryTab", () => ({
  MemoryTab: () => <div data-testid="memory-tab" />,
}));
vi.mock("@/components/ai-staff/workfile/WorkfileTab", () => ({
  WorkfileTab: () => <div data-testid="workfile-tab" />,
}));

// Stub MultiUserPicker used inside DmOutboundPolicyBlock
vi.mock("@/components/ai-staff/MultiUserPicker", () => ({
  MultiUserPicker: () => <div data-testid="multi-user-picker" />,
}));

import { CommonStaffDetailSection } from "../CommonStaffDetailSection";

// ------------------------------------------------------------------ helpers

const BASE_BOT: CommonStaffBotInfo = {
  botId: "bot-2",
  userId: "user-bot-2",
  username: "common_bot",
  displayName: "Team Assistant",
  roleTitle: "Engineer",
  persona: null,
  jobDescription: null,
  avatarUrl: null,
  model: { provider: "anthropic", id: "claude-sonnet-4-6" },
  mentorId: "user-mentor-1",
  mentorDisplayName: "Mentor",
  mentorAvatarUrl: null,
  dmOutboundPolicy: { mode: "same-tenant" },
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  managedMeta: null,
};

const BASE_APP: InstalledApplicationWithBots = {
  id: "app-2",
  applicationId: "common-staff",
  name: "Common Staff",
  description: "",
  tenantId: "ws-1",
  config: {},
  permissions: {},
  status: "active",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  bots: [],
  instanceStatus: null,
};

function renderSection(botOverrides: Partial<CommonStaffBotInfo> = {}) {
  const bot = { ...BASE_BOT, ...botOverrides };
  return render(
    <CommonStaffDetailSection bot={bot} app={BASE_APP} workspaceId="ws-1" />,
  );
}

// ------------------------------------------------------------------ tests

describe("CommonStaffDetailSection — DmOutboundPolicyBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: null, isLoading: false });
  });

  it("renders the Outbound DM section heading", () => {
    renderSection();
    expect(screen.getByText("Outbound DM")).toBeInTheDocument();
  });

  it("does NOT show the owner-only radio (hideOwnerOnly=true)", () => {
    renderSection();
    expect(screen.queryByLabelText(/owner only/i)).not.toBeInTheDocument();
  });

  it("shows the 3 non-owner modes", () => {
    renderSection();
    expect(screen.getByLabelText(/same workspace/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/whitelist/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/anyone/i)).toBeInTheDocument();
  });

  it("mentor sees editable block (radios not disabled)", () => {
    renderSection({ mentorId: "user-mentor-1" }); // matches currentUser.id
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    const disabledRadios = radios.filter(
      (r) => (r as HTMLInputElement).disabled,
    );
    expect(disabledRadios).toHaveLength(0);
  });

  it("non-mentor sees disabled block", () => {
    renderSection({ mentorId: "user-other-99" }); // different from currentUser.id
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => {
      expect(r).toBeDisabled();
    });
  });

  it("null mentorId means no one is mentor — block is disabled", () => {
    renderSection({ mentorId: null });
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => {
      expect(r).toBeDisabled();
    });
  });

  it("mode change calls mutate with dmOutboundPolicy", () => {
    renderSection({
      mentorId: "user-mentor-1",
      dmOutboundPolicy: { mode: "same-tenant" },
    });
    // Click the "Anyone" radio to change mode
    const anyoneRadio = screen.getByLabelText(/anyone/i);
    fireEvent.click(anyoneRadio);
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ dmOutboundPolicy: { mode: "anyone" } }),
    );
  });

  it("defaults to same-tenant when dmOutboundPolicy is absent", () => {
    renderSection({ dmOutboundPolicy: undefined });
    const sameTenantRadio = screen.getByLabelText(/same workspace/i);
    expect(sameTenantRadio).toBeChecked();
  });
});
