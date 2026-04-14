import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceResponse } from "@/types/workspace";

const workspaceDetail: WorkspaceResponse = {
  id: "ws-1",
  name: "Weight Wave",
  slug: "weight-wave",
  domain: null,
  logoUrl: null,
  plan: "free",
  isActive: true,
  createdAt: "2026-03-31T00:00:00.000Z",
  updatedAt: "2026-03-31T00:00:00.000Z",
};

const mockUseWorkspace = vi.hoisted(() => vi.fn());
const mockUseCurrentWorkspaceRole = vi.hoisted(() => vi.fn());
const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockUseUpdateWorkspace = vi.hoisted(() => vi.fn());
const mockWorkspaceStore = vi.hoisted(() => vi.fn());
const mockPresign = vi.hoisted(() => vi.fn());
const mockUploadToS3 = vi.hoisted(() => vi.fn());
const mockConfirmUpload = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: mockUseWorkspace,
  useCurrentWorkspaceRole: mockUseCurrentWorkspaceRole,
  useUpdateWorkspace: mockUseUpdateWorkspace,
}));

vi.mock("@/stores", () => ({
  useWorkspaceStore: mockWorkspaceStore,
}));

vi.mock("@/services/api/file", () => ({
  fileApi: {
    createPresignedUpload: mockPresign,
    uploadToS3: mockUploadToS3,
    confirmUpload: mockConfirmUpload,
  },
}));

import { WorkspaceSettingsContent } from "../WorkspaceSettingsContent";

describe("WorkspaceSettingsContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockWorkspaceStore.mockReturnValue({
      selectedWorkspaceId: "ws-1",
    });

    mockUseWorkspace.mockReturnValue({
      data: workspaceDetail,
      isLoading: false,
      error: null,
    });

    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: true,
      isAdmin: false,
      isOwnerOrAdmin: true,
    });

    mockUseUpdateWorkspace.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    mockPresign.mockResolvedValue({
      url: "https://upload.example.com",
      key: "logos/ws-1/logo.png",
      fields: { key: "logos/ws-1/logo.png" },
      publicUrl: "https://cdn.example.com/logo.png",
    });

    mockUploadToS3.mockResolvedValue(undefined);
    mockConfirmUpload.mockResolvedValue({
      key: "logos/ws-1/logo.png",
      fileName: "logo.png",
      fileSize: 1234,
      mimeType: "image/png",
      visibility: "public",
    });
  });

  it("renders workspace form fields from the loaded workspace", async () => {
    render(<WorkspaceSettingsContent />);

    expect(await screen.findByDisplayValue("Weight Wave")).toBeInTheDocument();
    expect(screen.getByDisplayValue("weight-wave")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
  });

  it("renders the workspace ID as a read-only field and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<WorkspaceSettingsContent />);

    await screen.findByDisplayValue("Weight Wave");
    const idText = screen.getByText("ws-1");
    expect(idText.tagName).toBe("SPAN");
    expect(screen.queryByDisplayValue("ws-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy workspace id/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ws-1"));
  });

  it("shows validation and blocks invalid slug submission", async () => {
    render(<WorkspaceSettingsContent />);

    fireEvent.change(await screen.findByLabelText(/slug/i), {
      target: { value: "Bad Slug!" },
    });

    expect(screen.getByText("slugInvalidFormat")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
  });

  it("blocks direct access for non-admin users", async () => {
    mockUseCurrentWorkspaceRole.mockReturnValue({
      isOwner: false,
      isAdmin: false,
      isOwnerOrAdmin: false,
    });

    render(<WorkspaceSettingsContent />);

    expect(
      await screen.findByText(
        /you don't have permission to edit workspace settings/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/workspace logo/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });

  it("uploads a logo and saves the edited workspace", async () => {
    mockMutateAsync.mockResolvedValue({
      ...workspaceDetail,
      name: "Renamed Workspace",
      logoUrl: "https://cdn.example.com/logo.png",
    });

    render(<WorkspaceSettingsContent />);

    fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() => expect(mockPresign).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Renamed Workspace" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        data: {
          name: "Renamed Workspace",
          logoUrl: "https://cdn.example.com/logo.png",
        },
      }),
    );

    expect(mockPresign).toHaveBeenCalled();
    expect(mockUploadToS3).toHaveBeenCalled();
    expect(mockConfirmUpload).toHaveBeenCalledWith({
      key: "logos/ws-1/logo.png",
      fileName: "logo.png",
      visibility: "public",
    });
  });

  it("shows error when file exceeds size limit", async () => {
    render(<WorkspaceSettingsContent />);

    const bigFile = new File(["x".repeat(6 * 1024 * 1024)], "huge.png", {
      type: "image/png",
    });
    Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024 });

    fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
      target: { files: [bigFile] },
    });

    expect(screen.getByText("logoTooLarge")).toBeInTheDocument();
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("shows error when file type is not allowed", async () => {
    render(<WorkspaceSettingsContent />);

    const gifFile = new File(["gif"], "anim.gif", { type: "image/gif" });

    fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
      target: { files: [gifFile] },
    });

    expect(screen.getByText("logoInvalidType")).toBeInTheDocument();
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("rejects svg uploads", async () => {
    render(<WorkspaceSettingsContent />);

    const svgFile = new File(["<svg></svg>"], "logo.svg", {
      type: "image/svg+xml",
    });

    fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
      target: { files: [svgFile] },
    });

    expect(screen.getByText("logoInvalidType")).toBeInTheDocument();
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("shows error when logo upload fails", async () => {
    mockPresign.mockRejectedValue(new Error("Network error"));

    render(<WorkspaceSettingsContent />);

    fireEvent.change(await screen.findByLabelText(/workspace logo/i), {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(screen.getByText("Network error")).toBeInTheDocument(),
    );
  });

  it("shows error when save fails", async () => {
    mockMutateAsync.mockRejectedValue(new Error("Server error"));

    render(<WorkspaceSettingsContent />);

    fireEvent.change(await screen.findByLabelText(/^name$/i), {
      target: { value: "New Name" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByText("Server error")).toBeInTheDocument(),
    );
  });

  it("shows slug-taken error on 409 conflict", async () => {
    const conflictError = new Error("Conflict");
    (conflictError as any).response = { status: 409 };
    mockMutateAsync.mockRejectedValue(conflictError);

    render(<WorkspaceSettingsContent />);

    fireEvent.change(await screen.findByLabelText(/slug/i), {
      target: { value: "taken-slug" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByText("slugAlreadyTaken")).toBeInTheDocument(),
    );
  });

  it("shows an error state when workspace details fail to load", async () => {
    mockUseWorkspace.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Load failed"),
      refetch: vi.fn(),
    });

    render(<WorkspaceSettingsContent />);

    expect(await screen.findByText("Load failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });
});
