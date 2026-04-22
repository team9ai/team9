import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

const mockIsTauriApp = vi.hoisted(() => vi.fn<() => boolean>());
vi.mock("@/lib/tauri", () => ({
  isTauriApp: mockIsTauriApp,
  isMacTauriApp: vi.fn(),
}));
vi.mock("./devices/ThisMacSection", () => ({
  ThisMacSection: () => createElement("div", { "data-testid": "this-mac" }),
}));
vi.mock("./devices/OtherDevicesList", () => ({
  OtherDevicesList: () =>
    createElement("div", { "data-testid": "other-devices" }),
}));
vi.mock("./devices/WebCtaCard", () => ({
  WebCtaCard: () => createElement("div", { "data-testid": "web-cta" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { DevicesDialog } from "./DevicesDialog";

function wrap(ui: React.ReactNode) {
  return createElement(QueryClientProvider, { client: new QueryClient() }, ui);
}

describe("DevicesDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders ThisMacSection in Tauri env", () => {
    mockIsTauriApp.mockReturnValue(true);
    render(
      wrap(
        createElement(DevicesDialog, { open: true, onOpenChange: () => {} }),
      ),
    );
    expect(screen.getByTestId("this-mac")).toBeInTheDocument();
    expect(screen.queryByTestId("web-cta")).toBeNull();
  });

  it("renders WebCtaCard in non-Tauri env", () => {
    mockIsTauriApp.mockReturnValue(false);
    render(
      wrap(
        createElement(DevicesDialog, { open: true, onOpenChange: () => {} }),
      ),
    );
    expect(screen.getByTestId("web-cta")).toBeInTheDocument();
    expect(screen.queryByTestId("this-mac")).toBeNull();
  });

  it("always renders OtherDevicesList", () => {
    mockIsTauriApp.mockReturnValue(false);
    render(
      wrap(
        createElement(DevicesDialog, { open: true, onOpenChange: () => {} }),
      ),
    );
    expect(screen.getByTestId("other-devices")).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    mockIsTauriApp.mockReturnValue(false);
    render(
      wrap(
        createElement(DevicesDialog, { open: false, onOpenChange: () => {} }),
      ),
    );
    expect(screen.queryByTestId("web-cta")).toBeNull();
  });
});
