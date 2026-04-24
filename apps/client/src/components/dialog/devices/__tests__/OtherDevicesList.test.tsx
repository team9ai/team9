import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { DeviceDto } from "@/services/ahand-api";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockToastError = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: mockToastSuccess, info: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, p?: object) => (p ? `${k}:${JSON.stringify(p)}` : k),
  }),
}));

const mockUseAhandDevices = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAhandDevices", () => ({
  useAhandDevices: mockUseAhandDevices,
  AHAND_DEVICES_QUERY_KEY: ["ahand", "devices"],
}));

const mockUseUser = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useAppStore", () => ({ useUser: mockUseUser }));

vi.mock("@/stores/useAhandStore", () => ({
  useAhandStore: (
    sel: (s: { getDeviceIdForUser: (id: string) => null }) => unknown,
  ) => sel({ getDeviceIdForUser: () => null }),
}));

const mockRemove = vi.hoisted(() => vi.fn());
const mockPatch = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-api", () => ({
  ahandApi: { remove: mockRemove, patch: mockPatch },
}));

vi.mock("@/lib/date-format", () => ({
  formatRelative: () => "2 hours ago",
}));

vi.mock("lucide-react", () => ({
  Pencil: () => <span data-testid="pencil-icon">✏</span>,
  Check: () => <span>✓</span>,
  X: () => <span>✗</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    onKeyDown,
    disabled,
    autoFocus,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    autoFocus?: boolean;
    className?: string;
  }) => (
    <input
      data-testid="nickname-input"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

import { OtherDevicesList } from "../OtherDevicesList";

// ── Helpers ────────────────────────────────────────────────────────────────

const DEVICE: DeviceDto = {
  id: "row-1",
  hubDeviceId: "hub-1",
  nickname: "My Laptop",
  platform: "macos",
  hostname: "mac.local",
  status: "active",
  lastSeenAt: "2026-04-22T10:00:00Z",
  isOnline: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, ui);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("OtherDevicesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({ id: "u1" });
    mockUseAhandDevices.mockReturnValue({ data: [DEVICE], isLoading: false });
    window.confirm = vi.fn().mockReturnValue(true);
  });

  // ── Rendering ─────────────────────────────────────────────────────────

  it("renders loading skeleton when isLoading=true", () => {
    mockUseAhandDevices.mockReturnValue({ data: undefined, isLoading: true });
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("renders nothing when device list is empty", () => {
    mockUseAhandDevices.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(
      wrap(<OtherDevicesList excludeLocal={false} />),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders device nickname and platform", () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    expect(screen.getByText("My Laptop")).toBeInTheDocument();
    expect(screen.getByText(/macos/)).toBeInTheDocument();
  });

  it("renders green dot for online device", () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const dot = document.querySelector(".bg-green-500");
    expect(dot).not.toBeNull();
  });

  it("renders muted dot for offline device", () => {
    mockUseAhandDevices.mockReturnValue({
      data: [{ ...DEVICE, isOnline: false }],
      isLoading: false,
    });
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const dot = document.querySelector(".bg-muted-foreground");
    expect(dot).not.toBeNull();
  });

  it("renders lastSeen date when lastSeenAt is set", () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    expect(screen.getByText(/lastSeen/)).toBeInTheDocument();
  });

  it("renders neverSeen when lastSeenAt is null", () => {
    mockUseAhandDevices.mockReturnValue({
      data: [{ ...DEVICE, lastSeenAt: null }],
      isLoading: false,
    });
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    // The key "neverSeen" is rendered as part of the sub-row text
    expect(screen.getByText(/neverSeen/)).toBeInTheDocument();
  });

  // ── Device filtering ───────────────────────────────────────────────────

  it("shows section heading with count", () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    expect(screen.getByText(/otherDevices/)).toBeInTheDocument();
  });

  // ── Remove device ──────────────────────────────────────────────────────

  it("remove button shows confirm dialog and calls API on confirm", async () => {
    mockRemove.mockResolvedValue(undefined);
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    fireEvent.click(screen.getByText("remove"));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("row-1"));
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
  });

  it("remove button does nothing when confirm is cancelled", async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    fireEvent.click(screen.getByText("remove"));
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("remove shows error toast on API failure", async () => {
    mockRemove.mockRejectedValue(new Error("api error"));
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    fireEvent.click(screen.getByText("remove"));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  // ── Nickname edit ──────────────────────────────────────────────────────

  it("clicking pencil icon shows the nickname input", async () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    expect(screen.getByTestId("nickname-input")).toBeInTheDocument();
  });

  it("Escape key cancels edit and reverts to original nickname", () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    const input = screen.getByTestId("nickname-input");
    fireEvent.change(input, { target: { value: "new name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("nickname-input")).toBeNull();
    expect(screen.getByText("My Laptop")).toBeInTheDocument();
  });

  it("Enter key submits nickname save", async () => {
    mockPatch.mockResolvedValue({ ...DEVICE, nickname: "New Name" });
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    const input = screen.getByTestId("nickname-input");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockPatch).toHaveBeenCalledWith("row-1", { nickname: "New Name" }),
    );
  });

  it("no-op save when nickname unchanged reverts to read mode", async () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    const input = screen.getByTestId("nickname-input");
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("nickname-input")).toBeNull();
  });

  it("empty trimmed draft reverts without API call", async () => {
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    const input = screen.getByTestId("nickname-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("nickname save shows error toast on API failure", async () => {
    mockPatch.mockRejectedValue(new Error("patch failed"));
    render(wrap(<OtherDevicesList excludeLocal={false} />));
    const pencil = screen.getByTestId("pencil-icon").closest("button")!;
    fireEvent.click(pencil);
    const input = screen.getByTestId("nickname-input");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });
});
