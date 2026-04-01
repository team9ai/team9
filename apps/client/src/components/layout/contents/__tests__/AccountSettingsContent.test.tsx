import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountSettingsContent } from "../AccountSettingsContent";

const mockUpdateCurrentUser = vi.hoisted(() => vi.fn());
const mockStartEmailChange = vi.hoisted(() => vi.fn());
const mockResendEmailChange = vi.hoisted(() => vi.fn());
const mockCancelEmailChange = vi.hoisted(() => vi.fn());
const mockCreatePresignedUpload = vi.hoisted(() => vi.fn());
const mockUploadToS3 = vi.hoisted(() => vi.fn());
const mockConfirmUpload = vi.hoisted(() => vi.fn());
const mockGetPublicDownloadUrl = vi.hoisted(() => vi.fn());

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
  },
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
  });

  it("renders the current avatar, display name, username, and email", () => {
    render(<AccountSettingsContent />);

    expect(screen.getByDisplayValue("Alice Wonder")).toBeInTheDocument();
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
});
