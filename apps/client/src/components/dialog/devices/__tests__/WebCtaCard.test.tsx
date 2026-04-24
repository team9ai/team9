import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockToastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: mockToastInfo } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    asChild?: boolean;
    size?: string;
    variant?: string;
  }) =>
    asChild ? <>{children}</> : <button onClick={onClick}>{children}</button>,
}));

import { WebCtaCard } from "../WebCtaCard";

describe("WebCtaCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders CTA title and body", () => {
    render(<WebCtaCard />);
    expect(screen.getByText("ctaTitle")).toBeInTheDocument();
    expect(screen.getByText("ctaBody")).toBeInTheDocument();
  });

  it("renders primary and secondary action buttons", () => {
    render(<WebCtaCard />);
    expect(screen.getByText("ctaPrimaryAction")).toBeInTheDocument();
    expect(screen.getByText("ctaSecondaryAction")).toBeInTheDocument();
  });

  it("triggers a setTimeout on primary button click (deep-link attempt)", () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    render(<WebCtaCard />);
    const primaryBtn = screen.getByText("ctaPrimaryAction");
    fireEvent.click(primaryBtn);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    setTimeoutSpy.mockRestore();
  });

  it("shows noAppInstalledHint toast when app is not installed (< 800ms elapsed)", () => {
    render(<WebCtaCard />);
    const primaryBtn = screen.getByText("ctaPrimaryAction");
    fireEvent.click(primaryBtn);
    vi.advanceTimersByTime(501);
    expect(mockToastInfo).toHaveBeenCalledWith("noAppInstalledHint");
  });

  it("does not show toast when page is hidden (app opened)", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    render(<WebCtaCard />);
    const primaryBtn = screen.getByText("ctaPrimaryAction");
    fireEvent.click(primaryBtn);
    vi.advanceTimersByTime(501);
    expect(mockToastInfo).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  describe("getDesktopDownloadUrl — platform detection", () => {
    it("returns mac URL for Mac userAgent", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        configurable: true,
      });
      render(<WebCtaCard />);
      const link = screen.getByText("ctaSecondaryAction").closest("a");
      expect(link?.href).toBe("https://team9.ai/download/mac");
    });

    it("returns windows URL for Win userAgent", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64)",
        configurable: true,
      });
      render(<WebCtaCard />);
      const link = screen.getByText("ctaSecondaryAction").closest("a");
      expect(link?.href).toBe("https://team9.ai/download/windows");
    });

    it("returns linux URL for Linux userAgent", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (X11; Linux x86_64)",
        configurable: true,
      });
      render(<WebCtaCard />);
      const link = screen.getByText("ctaSecondaryAction").closest("a");
      expect(link?.href).toBe("https://team9.ai/download/linux");
    });

    it("returns fallback URL for unknown userAgent", () => {
      Object.defineProperty(navigator, "userAgent", {
        value: "unknown-bot/1.0",
        configurable: true,
      });
      render(<WebCtaCard />);
      const link = screen.getByText("ctaSecondaryAction").closest("a");
      expect(link?.href).toBe("https://team9.ai/download");
    });
  });
});
