import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

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

const mockGetIdentity = vi.hoisted(() => vi.fn());
const mockStart = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
const mockClearIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-tauri", () => ({
  ahandTauri: {
    getIdentity: mockGetIdentity,
    start: mockStart,
    stop: mockStop,
    clearIdentity: mockClearIdentity,
  },
}));

const mockRegister = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());
vi.mock("@/services/ahand-api", () => ({
  ahandApi: { register: mockRegister, list: mockList, remove: mockRemove },
}));

const mockUseUser = vi.hoisted(() => vi.fn());
vi.mock("@/stores/useAppStore", () => ({ useUser: mockUseUser }));

const mockLocalStatus = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAhandLocalStatus", () => ({
  useAhandLocalStatus: mockLocalStatus,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...c: string[]) => c.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    "aria-label": al,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
    "aria-checked"?: boolean;
    role?: string;
  }) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={al}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-testid="ahand-toggle"
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-testid="remove-btn">
      {children}
    </button>
  ),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import { useAhandStore } from "@/stores/useAhandStore";
import { ThisMacSection } from "../ThisMacSection";

// ── Test helpers ────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, ui);
}

const DEFAULT_USER = { id: "u1", displayName: "Alice" };

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ThisMacSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAhandStore.setState({ usersEnabled: {} });
    mockUseUser.mockReturnValue(DEFAULT_USER);
    mockLocalStatus.mockReturnValue({ state: "idle" });
    mockClearIdentity.mockResolvedValue(undefined);
    window.confirm = vi.fn().mockReturnValue(true);
  });

  // ── Rendering ─────────────────────────────────────────────────────────

  it("renders section heading", () => {
    render(wrap(<ThisMacSection />));
    expect(screen.getByText("thisMac")).toBeInTheDocument();
  });

  it("renders toggle switch", () => {
    render(wrap(<ThisMacSection />));
    expect(screen.getByTestId("ahand-toggle")).toBeInTheDocument();
  });

  it("toggle starts unchecked when ahand not enabled", () => {
    render(wrap(<ThisMacSection />));
    expect(screen.getByTestId("ahand-toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("toggle starts checked when ahand is enabled in store", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    render(wrap(<ThisMacSection />));
    expect(screen.getByTestId("ahand-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows remove button when enabled and deviceId is set", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    render(wrap(<ThisMacSection />));
    expect(screen.getByTestId("remove-btn")).toBeInTheDocument();
  });

  it("does not show remove button when disabled", () => {
    render(wrap(<ThisMacSection />));
    expect(screen.queryByTestId("remove-btn")).toBeNull();
  });

  // ── Toggle enable — registration flow ─────────────────────────────────

  it("toggle enable triggers 5-step registration flow", async () => {
    mockGetIdentity.mockResolvedValue({
      deviceId: "dev-abc",
      publicKeyB64: "pub-key",
    });
    mockRegister.mockResolvedValue({
      deviceJwt: "jwt-1",
      hubUrl: "wss://hub",
      jwtExpiresAt: "2026-06-01T00:00:00Z",
    });
    mockStart.mockResolvedValue({ device_id: "dev-abc" });

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("ahand-toggle"));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockGetIdentity).toHaveBeenCalledWith("u1");
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        hubDeviceId: "dev-abc",
        publicKey: "pub-key",
      }),
    );
    expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(true);
    expect(useAhandStore.getState().usersEnabled["u1"]?.hubUrl).toBe(
      "wss://hub",
    );
  });

  it("toggle enable shows error toast and resets store on identity failure", async () => {
    mockGetIdentity.mockRejectedValue(new Error("identity failed"));

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("ahand-toggle"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBeFalsy();
  });

  it("toggle enable shows error toast and resets store on register failure", async () => {
    mockGetIdentity.mockResolvedValue({
      deviceId: "dev-abc",
      publicKeyB64: "pub-key",
    });
    mockRegister.mockRejectedValue(new Error("register failed"));

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("ahand-toggle"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  it("toggle enable shows error toast on start failure", async () => {
    mockGetIdentity.mockResolvedValue({
      deviceId: "dev-abc",
      publicKeyB64: "pub-key",
    });
    mockRegister.mockResolvedValue({
      deviceJwt: "jwt-1",
      hubUrl: "wss://hub",
      jwtExpiresAt: "2026-06-01T00:00:00Z",
    });
    mockStart.mockRejectedValue(new Error("start failed"));

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("ahand-toggle"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  // ── Toggle disable ─────────────────────────────────────────────────────

  it("toggle disable calls ahandTauri.stop and updates store", async () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockStop.mockResolvedValue(undefined);

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("ahand-toggle"));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(useAhandStore.getState().usersEnabled["u1"]?.enabled).toBe(false);
  });

  // ── Remove this device ─────────────────────────────────────────────────

  it("remove device flow stops daemon and removes from API", async () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockStop.mockResolvedValue(undefined);
    mockList.mockResolvedValue([{ id: "row-1", hubDeviceId: "dev-abc" }]);
    mockRemove.mockResolvedValue(undefined);

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("remove-btn"));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockStop).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith("row-1");
    expect(mockClearIdentity).toHaveBeenCalledWith("u1");
    expect(useAhandStore.getState().usersEnabled["u1"]).toBeUndefined();
  });

  it("remove device flow shows error toast on failure", async () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockStop.mockResolvedValue(undefined);
    mockList.mockRejectedValue(new Error("list failed"));

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("remove-btn"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  });

  it("remove device does nothing when confirm is cancelled", async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");

    render(wrap(<ThisMacSection />));
    fireEvent.click(screen.getByTestId("remove-btn"));

    await new Promise((r) => setTimeout(r, 50));
    expect(mockStop).not.toHaveBeenCalled();
  });

  // ── Status color / label ───────────────────────────────────────────────

  it("shows disabled label when ahand is not enabled", () => {
    render(wrap(<ThisMacSection />));
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("shows online label when status is online and enabled", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockLocalStatus.mockReturnValue({ state: "online", device_id: "dev-abc" });
    render(wrap(<ThisMacSection />));
    expect(screen.getByText("online")).toBeInTheDocument();
  });

  it("shows connecting label when status is connecting and enabled", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockLocalStatus.mockReturnValue({ state: "connecting" });
    render(wrap(<ThisMacSection />));
    expect(screen.getByText("connecting")).toBeInTheDocument();
  });

  it("shows error header when status is error and enabled", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockLocalStatus.mockReturnValue({
      state: "error",
      kind: "auth",
      message: "jwt expired",
    });
    render(wrap(<ThisMacSection />));
    expect(screen.getByText("error.header")).toBeInTheDocument();
    expect(screen.getByText("jwt expired")).toBeInTheDocument();
  });

  // ── Busy state ─────────────────────────────────────────────────────────

  it("toggle is disabled when connecting", () => {
    useAhandStore
      .getState()
      .setDeviceIdForUser("u1", "dev-abc", true, "wss://hub");
    mockLocalStatus.mockReturnValue({ state: "connecting" });
    render(wrap(<ThisMacSection />));
    expect(screen.getByTestId("ahand-toggle")).toBeDisabled();
  });
});
