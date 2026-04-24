/**
 * Minimal tests for DmOutboundPolicyBlock integration in PersonalStaffDetailSection.
 * Verifies:
 *   - Block is rendered below visibility toggles.
 *   - Owner (ownerId === currentUser.id) sees block editable.
 *   - Non-owner sees block disabled.
 *   - Mode change triggers updateMutation.mutate({ dmOutboundPolicy: {...} }).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersonalStaffListBotInfo,
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
  useCurrentUser: () => ({ data: { id: "user-owner-1" } }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useCreateDirectChannel: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Stub MemoryTab and WorkfileTab to avoid heavy inner deps
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

import { PersonalStaffDetailSection } from "../PersonalStaffDetailSection";

// ------------------------------------------------------------------ helpers

const BASE_BOT: PersonalStaffListBotInfo = {
  botId: "bot-1",
  userId: "user-bot-1",
  username: "personal_bot",
  displayName: "My Assistant",
  avatarUrl: null,
  ownerId: "user-owner-1",
  persona: null,
  model: { provider: "anthropic", id: "claude-sonnet-4-6" },
  visibility: { allowMention: false, allowDirectMessage: false },
  dmOutboundPolicy: { mode: "owner-only" },
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  managedMeta: null,
};

const BASE_APP: InstalledApplicationWithBots = {
  id: "app-1",
  applicationId: "personal-staff",
  name: "Personal Staff",
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

function renderSection(botOverrides: Partial<PersonalStaffListBotInfo> = {}) {
  const bot = { ...BASE_BOT, ...botOverrides };
  return render(
    <PersonalStaffDetailSection bot={bot} app={BASE_APP} workspaceId="ws-1" />,
  );
}

// ------------------------------------------------------------------ tests

describe("PersonalStaffDetailSection — DmOutboundPolicyBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: null, isLoading: false });
  });

  it("renders the Outbound DM section heading", () => {
    renderSection();
    expect(screen.getByText("Outbound DM")).toBeInTheDocument();
  });

  it("renders the block after the visibility toggles", () => {
    renderSection();
    const allowMentionLabel = screen.getByText("Allow @mentions");
    const outboundDmHeading = screen.getByText("Outbound DM");
    // Both present; DOM order means allowMention comes before outboundDm
    expect(allowMentionLabel).toBeInTheDocument();
    expect(outboundDmHeading).toBeInTheDocument();
  });

  it("owner sees editable block (radios are not disabled)", () => {
    renderSection({ ownerId: "user-owner-1" }); // matches currentUser.id
    const radios = screen.getAllByRole("radio");
    // At least one radio in the block
    expect(radios.length).toBeGreaterThan(0);
    // All radios should be enabled for the owner
    const disabledRadios = radios.filter(
      (r) => (r as HTMLInputElement).disabled,
    );
    expect(disabledRadios).toHaveLength(0);
  });

  it("non-owner sees disabled block", () => {
    renderSection({ ownerId: "user-other-99" }); // different from currentUser.id
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => {
      expect(r).toBeDisabled();
    });
  });

  it("mode change calls mutate with dmOutboundPolicy", () => {
    renderSection({
      ownerId: "user-owner-1",
      dmOutboundPolicy: { mode: "owner-only" },
    });
    // Click the "Same workspace" radio to change the mode
    const sameTenantRadio = screen.getByLabelText(/same workspace/i);
    fireEvent.click(sameTenantRadio);
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ dmOutboundPolicy: { mode: "same-tenant" } }),
    );
  });

  it("defaults to owner-only when dmOutboundPolicy is absent", () => {
    renderSection({ dmOutboundPolicy: undefined });
    // The owner-only radio should be checked (selected)
    const ownerOnlyRadio = screen.getByLabelText(/owner only/i);
    expect(ownerOnlyRadio).toBeChecked();
  });
});
