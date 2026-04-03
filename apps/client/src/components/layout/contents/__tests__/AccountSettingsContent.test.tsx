import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountSettingsContent } from "../AccountSettingsContent";

const mockUpdateCurrentUser = vi.hoisted(() => vi.fn());
const mockStartEmailChange = vi.hoisted(() => vi.fn());
const mockResendEmailChange = vi.hoisted(() => vi.fn());
const mockCancelEmailChange = vi.hoisted(() => vi.fn());
const mockCreatePresignedUpload = vi.hoisted(() => vi.fn());
const mockUploadToS3 = vi.hoisted(() => vi.fn());
const mockConfirmUpload = vi.hoisted(() => vi.fn());
const mockGetPublicDownloadUrl = vi.hoisted(() => vi.fn());
const mockGetStablePublicFileUrl = vi.hoisted(() => vi.fn());
const desktopUpdaterState = vi.hoisted(() => ({
  current: {
    availableUpdate: null as null | {
      currentVersion: string;
      version: string;
      notes: string | null;
      pubDate: string | null;
    },
    currentVersion: null as string | null,
    errorKey: null as "notConfigured" | null,
    errorMessage: null as string | null,
    isChecking: false,
    isInstalling: false,
    isSupported: false,
    status: null as "upToDate" | "installing" | null,
    checkForUpdates: vi.fn(async () => {}),
    installUpdate: vi.fn(async () => {}),
  },
}));

const currentUserState = vi.hoisted(() => ({
  current: {
    id: "user-1",
    email: "alice@example.com",
    username: "alice_wonder",
    displayName: "Alice Wonder",
    avatarUrl: "https://cdn.example.com/avatar.png",
    isActive: true,
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
}));

const pendingEmailState = vi.hoisted(() => ({
  current: null as {
    pendingEmailChange: {
      id: string;
      currentEmail: string;
      newEmail: string;
      expiresAt?: string;
      createdAt?: string;
    } | null;
  } | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, string>,
      options?: Record<string, string>,
    ) => {
      const fallback =
        typeof fallbackOrOptions === "string" ? fallbackOrOptions : key;
      const values =
        typeof fallbackOrOptions === "object" && fallbackOrOptions
          ? fallbackOrOptions
          : (options ?? {});

      return Object.entries(values).reduce(
        (text, [name, value]) =>
          text.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), value),
        fallback,
      );
    },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({
    data: currentUserState.current,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useUpdateCurrentUser: () => ({
    mutateAsync: mockUpdateCurrentUser,
    isPending: false,
  }),
  usePendingEmailChange: () => ({
    data: pendingEmailState.current,
    isLoading: false,
  }),
  useStartEmailChange: () => ({
    mutateAsync: mockStartEmailChange,
    isPending: false,
  }),
  useResendEmailChange: () => ({
    mutateAsync: mockResendEmailChange,
    isPending: false,
  }),
  useCancelEmailChange: () => ({
    mutateAsync: mockCancelEmailChange,
    isPending: false,
  }),
}));

vi.mock("@/services/api/file", () => ({
  fileApi: {
    createPresignedUpload: mockCreatePresignedUpload,
    uploadToS3: mockUploadToS3,
    confirmUpload: mockConfirmUpload,
    getPublicDownloadUrl: mockGetPublicDownloadUrl,
    getStablePublicFileUrl: mockGetStablePublicFileUrl,
  },
}));

vi.mock("@/hooks/useDesktopUpdater", () => ({
  useDesktopUpdater: () => desktopUpdaterState.current,
}));

describe("AccountSettingsContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserState.current = {
      id: "user-1",
      email: "alice@example.com",
      username: "alice_wonder",
      displayName: "Alice Wonder",
      avatarUrl: "https://cdn.example.com/avatar.png",
      isActive: true,
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    pendingEmailState.current = null;
    mockCreatePresignedUpload.mockResolvedValue({
      url: "https://s3.example.com/presigned",
      key: "avatars/user-1.png",
      fields: {},
      publicUrl: "https://cdn.example.com/avatars/user-1.png",
    });
    mockUploadToS3.mockResolvedValue(undefined);
    mockConfirmUpload.mockResolvedValue({
      id: "file-1",
      key: "avatars/user-1.png",
      fileName: "avatar.png",
      fileSize: 1200,
      mimeType: "image/png",
      visibility: "public",
    });
    mockGetPublicDownloadUrl.mockResolvedValue({
      url: "https://cdn.example.com/avatars/user-1.png",
      expiresAt: "2026-04-02T00:00:00.000Z",
    });
    mockGetStablePublicFileUrl.mockReturnValue(
      "http://localhost:3000/api/v1/files/public/file/file-1",
    );
    mockUpdateCurrentUser.mockResolvedValue(currentUserState.current);
    mockStartEmailChange.mockResolvedValue({
      message: "Confirmation email sent.",
      pendingEmailChange: null,
    });
    mockResendEmailChange.mockResolvedValue({
      message: "Confirmation email resent.",
      pendingEmailChange: null,
    });
    mockCancelEmailChange.mockResolvedValue({
      message: "Pending email change cancelled.",
    });
    desktopUpdaterState.current = {
      availableUpdate: null,
      currentVersion: null,
      errorKey: null,
      errorMessage: null,
      isChecking: false,
      isInstalling: false,
      isSupported: false,
      status: null,
      checkForUpdates: vi.fn(async () => {}),
      installUpdate: vi.fn(async () => {}),
    };
  });

  it("renders the current avatar, display name, username, and email", async () => {
    render(<AccountSettingsContent />);

    expect(await screen.findByDisplayValue("Alice Wonder")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alice_wonder")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("AW")).toBeInTheDocument();
  });

  it("blocks an invalid username and shows a validation message", async () => {
    render(<AccountSettingsContent />);

    const usernameInput = screen.getByLabelText("Username");
    fireEvent.change(usernameInput, { target: { value: "Alice Smith!" } });

    expect(
      screen.getByText(
        "Username can only contain lowercase letters, numbers, underscores, and hyphens",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows a specific error when the username is already taken", async () => {
    mockUpdateCurrentUser.mockRejectedValue({
      status: 409,
      response: {
        data: {
          message: "Username is already taken",
        },
      },
    });

    render(<AccountSettingsContent />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "taken_name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("That username is already taken"),
    ).toBeInTheDocument();
  });

  it("shows pending email change actions when one exists", () => {
    pendingEmailState.current = {
      pendingEmailChange: {
        id: "req-1",
        currentEmail: "alice@example.com",
        newEmail: "alice+new@example.com",
        expiresAt: "2026-04-01T10:00:00.000Z",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    };

    render(<AccountSettingsContent />);

    expect(
      screen.getByText("Pending email change to alice+new@example.com"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend confirmation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel request" }),
    ).toBeInTheDocument();
  });

  it("shows the new email request form when no pending request exists", () => {
    render(<AccountSettingsContent />);

    expect(screen.getByLabelText("New email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request change" }),
    ).toBeDisabled();
  });

  it("shows a specific error when the new email is already in use", async () => {
    mockStartEmailChange.mockRejectedValue({
      status: 409,
      response: {
        data: {
          message: "Email already in use",
        },
      },
    });

    render(<AccountSettingsContent />);

    fireEvent.change(screen.getByLabelText("New email"), {
      target: { value: "taken@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request change" }));

    expect(
      await screen.findByText("That email is already in use"),
    ).toBeInTheDocument();
  });

  it("rejects avatar files that are not supported images", () => {
    render(<AccountSettingsContent />);

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const badFile = new File(["svg"], "avatar.svg", {
      type: "image/svg+xml",
    });

    fireEvent.change(fileInput, { target: { files: [badFile] } });

    expect(
      screen.getByText("Avatar must be a JPEG, PNG, or WebP image"),
    ).toBeInTheDocument();
    expect(mockCreatePresignedUpload).not.toHaveBeenCalled();
  });

  it("persists the stable public avatar URL on save", async () => {
    render(<AccountSettingsContent />);

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const avatarFile = new File(["avatar"], "avatar.png", {
      type: "image/png",
    });

    fireEvent.change(fileInput, { target: { files: [avatarFile] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdateCurrentUser).toHaveBeenCalledWith({
        avatarUrl: "http://localhost:3000/api/v1/files/public/file/file-1",
      });
    });
    expect(mockGetStablePublicFileUrl).toHaveBeenCalledWith("file-1");
    expect(mockGetPublicDownloadUrl).not.toHaveBeenCalled();
  });

  it("shows the desktop updater card for Tauri builds", () => {
    desktopUpdaterState.current = {
      ...desktopUpdaterState.current,
      currentVersion: "1.0.0",
      isSupported: true,
    };

    render(<AccountSettingsContent />);

    expect(screen.getByText("Desktop app updates")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeInTheDocument();
  });
});
