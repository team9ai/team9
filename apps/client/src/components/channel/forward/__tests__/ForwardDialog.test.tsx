import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// ── Hoisted mocks (must come before imports that use these) ─────────────────

const mockToast = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(mockToast, { error: mockToastError }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, params?: { count?: number }) =>
      params?.count !== undefined ? `${k}:${params.count}` : k,
  }),
}));

const mockForwardCreate = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({
  api: {
    forward: {
      create: mockForwardCreate,
    },
  },
}));

// Mock child components so ForwardDialog tests focus on dialog logic only
vi.mock("../ForwardChannelList", () => ({
  ForwardChannelList: ({
    selectedChannelId,
    onSelect,
    excludeChannelId,
  }: {
    selectedChannelId: string | null;
    onSelect: (id: string) => void;
    excludeChannelId?: string;
  }) => (
    <div data-testid="forward-channel-list" data-exclude={excludeChannelId}>
      <button data-testid="select-ch1" onClick={() => onSelect("ch1")}>
        Select ch1
      </button>
      <button data-testid="select-ch2" onClick={() => onSelect("ch2")}>
        Select ch2
      </button>
      <span data-testid="selected-value">{selectedChannelId ?? "none"}</span>
    </div>
  ),
}));

vi.mock("../ForwardPreview", () => ({
  ForwardPreview: ({ messages }: { messages: { id: string }[] }) => (
    <div data-testid="forward-preview" data-count={messages.length}>
      Preview ({messages.length} messages)
    </div>
  ),
}));

// Minimal Dialog mock: renders children when open=true
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-testid={variant === "outline" ? "cancel-button" : "confirm-button"}
    >
      {children}
    </button>
  ),
}));

import { ForwardDialog } from "../ForwardDialog";
import type { Message, IMUser } from "@/types/im";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channelId: "source-ch",
    senderId: "u1",
    content: `Message ${id}`,
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sender: {
      id: "u1",
      email: "user@example.com",
      username: "user",
      displayName: "User One",
      status: "online",
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as IMUser,
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? makeQueryClient();
  return createElement(QueryClientProvider, { client }, ui);
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  sourceChannelId: "source-ch",
  sourceMessages: [makeMessage("m1")],
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockForwardCreate.mockResolvedValue({ id: "new-msg" });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ForwardDialog", () => {
  describe("rendering", () => {
    it("renders nothing when open=false", () => {
      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            open={false}
            onOpenChange={vi.fn()}
          />,
        ),
      );

      expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    });

    it("renders dialog when open=true", () => {
      render(wrap(<ForwardDialog {...defaultProps} />));

      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("forward-channel-list")).toBeInTheDocument();
      expect(screen.getByTestId("forward-preview")).toBeInTheDocument();
    });

    it("shows single message title when sourceMessages has 1 message", () => {
      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            sourceMessages={[makeMessage("m1")]}
          />,
        ),
      );

      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "forward.dialog.titleSingle",
      );
    });

    it("shows bundle title with count when sourceMessages has multiple messages", () => {
      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            sourceMessages={[makeMessage("m1"), makeMessage("m2")]}
          />,
        ),
      );

      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "forward.dialog.titleBundle:2",
      );
    });

    it("passes sourceChannelId as excludeChannelId to ForwardChannelList", () => {
      render(
        wrap(<ForwardDialog {...defaultProps} sourceChannelId="source-ch" />),
      );

      expect(screen.getByTestId("forward-channel-list")).toHaveAttribute(
        "data-exclude",
        "source-ch",
      );
    });

    it("passes sourceMessages count to ForwardPreview", () => {
      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            sourceMessages={[makeMessage("m1"), makeMessage("m2")]}
          />,
        ),
      );

      expect(screen.getByTestId("forward-preview")).toHaveAttribute(
        "data-count",
        "2",
      );
    });
  });

  describe("confirm button state", () => {
    it("confirm button is disabled when no channel is selected", () => {
      render(wrap(<ForwardDialog {...defaultProps} />));

      const confirmBtn = screen.getByTestId("confirm-button");
      expect(confirmBtn).toBeDisabled();
    });

    it("confirm button is enabled after a channel is selected", () => {
      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));

      const confirmBtn = screen.getByTestId("confirm-button");
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  describe("cancel button", () => {
    it("cancel button calls onOpenChange(false)", () => {
      const onOpenChange = vi.fn();
      render(
        wrap(<ForwardDialog {...defaultProps} onOpenChange={onOpenChange} />),
      );

      fireEvent.click(screen.getByTestId("cancel-button"));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("successful forward", () => {
    it("calls api.forward.create with correct args", async () => {
      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            sourceChannelId="source-ch"
            sourceMessages={[makeMessage("m1"), makeMessage("m2")]}
          />,
        ),
      );

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockForwardCreate).toHaveBeenCalledWith({
          targetChannelId: "ch1",
          sourceChannelId: "source-ch",
          sourceMessageIds: ["m1", "m2"],
        });
      });
    });

    it("shows success toast after successful forward", async () => {
      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("forward.success");
      });
    });

    it("closes dialog on success", async () => {
      const onOpenChange = vi.fn();
      render(
        wrap(<ForwardDialog {...defaultProps} onOpenChange={onOpenChange} />),
      );

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("calls onSuccess callback after successful forward", async () => {
      const onSuccess = vi.fn();
      render(wrap(<ForwardDialog {...defaultProps} onSuccess={onSuccess} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledOnce();
      });
    });

    it("does not throw when onSuccess is not provided", async () => {
      const { onSuccess: _, ...propsWithoutSuccess } = defaultProps;
      render(wrap(<ForwardDialog {...propsWithoutSuccess} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("forward.success");
      });
    });

    it("resets selected channel after success", async () => {
      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      expect(screen.getByTestId("selected-value")).toHaveTextContent("ch1");

      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("forward.success");
      });

      // After success, selected value should be reset (dialog closes, but
      // the internal state is reset to null)
      expect(screen.getByTestId("selected-value")).toHaveTextContent("none");
    });
  });

  describe("error handling", () => {
    it("shows error toast on API failure with forward.noWriteAccess", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.noWriteAccess" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "forward.error.noWriteAccess",
        );
      });
    });

    it("maps forward.mixedChannels error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.mixedChannels" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "forward.error.mixedChannels",
        );
      });
    });

    it("maps forward.noSourceAccess error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.noSourceAccess" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "forward.error.noSourceAccess",
        );
      });
    });

    it("maps forward.tooManySelected error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.tooManySelected" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.tooManySelected");
      });
    });

    it("maps forward.notAllowed error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.notAllowed" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notAllowed");
      });
    });

    it("maps forward.notFound error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.notFound" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notFound");
      });
    });

    it("maps forward.empty error code correctly", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.empty" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.empty");
      });
    });

    it("falls back to forward.error.notAllowed for unknown error code", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.unknownCode" } },
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notAllowed");
      });
    });

    it("falls back to notAllowed when error has no response body (plain Error)", async () => {
      mockForwardCreate.mockRejectedValue(new Error("Network error"));

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notAllowed");
      });
    });

    it("falls back to notAllowed when error is not an object", async () => {
      mockForwardCreate.mockRejectedValue("string error");

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notAllowed");
      });
    });

    it("falls back to notAllowed when error object has non-string message", async () => {
      mockForwardCreate.mockRejectedValue({ message: 42 });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("forward.error.notAllowed");
      });
    });

    it("does not close dialog on error", async () => {
      mockForwardCreate.mockRejectedValue({
        response: { data: { message: "forward.noWriteAccess" } },
      });

      const onOpenChange = vi.fn();
      render(
        wrap(<ForwardDialog {...defaultProps} onOpenChange={onOpenChange} />),
      );

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalled();
      });

      // Should NOT have called onOpenChange(false)
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("uses error.message as code when response.data.message is absent", async () => {
      mockForwardCreate.mockRejectedValue({
        message: "forward.noWriteAccess",
      });

      render(wrap(<ForwardDialog {...defaultProps} />));

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "forward.error.noWriteAccess",
        );
      });
    });
  });

  describe("query invalidation on success", () => {
    it("invalidates channelMessages query for target channel", async () => {
      const qc = makeQueryClient();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      render(
        wrap(
          <ForwardDialog
            {...defaultProps}
            sourceChannelId="source-ch"
            sourceMessages={[makeMessage("m1")]}
          />,
          qc,
        ),
      );

      fireEvent.click(screen.getByTestId("select-ch1"));
      fireEvent.click(screen.getByTestId("confirm-button"));

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ["channelMessages", "ch1"],
        });
      });
    });
  });
});
