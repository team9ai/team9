import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

const mockUseChannels = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useChannels", () => ({
  useChannels: mockUseChannels,
}));

// Mock Input to avoid deep UI component tree
vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
    type,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
    type?: string;
  }) => (
    <input
      type={type ?? "text"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid="channel-search-input"
    />
  ),
}));

import { ForwardChannelList } from "../ForwardChannelList";

const makeChannel = (
  id: string,
  name: string,
  overrides: {
    isArchived?: boolean;
    isActivated?: boolean;
  } = {},
) => ({
  id,
  tenantId: "t1",
  name,
  type: "public" as const,
  createdBy: "u1",
  order: 0,
  isArchived: false,
  isActivated: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  mockUseChannels.mockReturnValue({ data: [] });
});

describe("ForwardChannelList", () => {
  describe("happy path — renders channels", () => {
    it("renders all eligible channels", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general"), makeChannel("ch2", "random")],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      expect(screen.getByText("#general")).toBeInTheDocument();
      expect(screen.getByText("#random")).toBeInTheDocument();
    });

    it("marks the selected channel with aria-selected=true", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general")],
      });

      render(<ForwardChannelList selectedChannelId="ch1" onSelect={vi.fn()} />);

      const option = screen.getByRole("option", { name: "#general" });
      expect(option).toHaveAttribute("aria-selected", "true");
    });

    it("marks unselected channels with aria-selected=false", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general"), makeChannel("ch2", "random")],
      });

      render(<ForwardChannelList selectedChannelId="ch1" onSelect={vi.fn()} />);

      const randomOption = screen.getByRole("option", { name: "#random" });
      expect(randomOption).toHaveAttribute("aria-selected", "false");
    });
  });

  describe("filtering", () => {
    it("excludes the source channel", () => {
      mockUseChannels.mockReturnValue({
        data: [
          makeChannel("source", "source-channel"),
          makeChannel("target", "target-channel"),
        ],
      });

      render(
        <ForwardChannelList
          excludeChannelId="source"
          selectedChannelId={null}
          onSelect={vi.fn()}
        />,
      );

      expect(screen.queryByText("#source-channel")).not.toBeInTheDocument();
      expect(screen.getByText("#target-channel")).toBeInTheDocument();
    });

    it("excludes archived channels", () => {
      mockUseChannels.mockReturnValue({
        data: [
          makeChannel("ch1", "archived", { isArchived: true }),
          makeChannel("ch2", "active"),
        ],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      expect(screen.queryByText("#archived")).not.toBeInTheDocument();
      expect(screen.getByText("#active")).toBeInTheDocument();
    });

    it("excludes deactivated channels (isActivated=false)", () => {
      mockUseChannels.mockReturnValue({
        data: [
          makeChannel("ch1", "deactivated", { isActivated: false }),
          makeChannel("ch2", "active"),
        ],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      expect(screen.queryByText("#deactivated")).not.toBeInTheDocument();
      expect(screen.getByText("#active")).toBeInTheDocument();
    });

    it("filters channels by name on search (case-insensitive)", () => {
      mockUseChannels.mockReturnValue({
        data: [
          makeChannel("ch1", "general"),
          makeChannel("ch2", "random"),
          makeChannel("ch3", "General-announcements"),
        ],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      const input = screen.getByTestId("channel-search-input");
      fireEvent.change(input, { target: { value: "gen" } });

      expect(screen.getByText("#general")).toBeInTheDocument();
      expect(screen.getByText("#General-announcements")).toBeInTheDocument();
      expect(screen.queryByText("#random")).not.toBeInTheDocument();
    });

    it("shows all channels when search is cleared", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general"), makeChannel("ch2", "random")],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      const input = screen.getByTestId("channel-search-input");
      fireEvent.change(input, { target: { value: "gen" } });
      expect(screen.queryByText("#random")).not.toBeInTheDocument();

      fireEvent.change(input, { target: { value: "" } });
      expect(screen.getByText("#random")).toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("calls onSelect with the channel id when a row is clicked", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general")],
      });

      const onSelect = vi.fn();
      render(
        <ForwardChannelList selectedChannelId={null} onSelect={onSelect} />,
      );

      fireEvent.click(screen.getByRole("option", { name: "#general" }));
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect).toHaveBeenCalledWith("ch1");
    });
  });

  describe("empty state", () => {
    it("renders empty list when no channels are returned", () => {
      mockUseChannels.mockReturnValue({ data: [] });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      const list = screen.getByRole("listbox");
      expect(list).toBeInTheDocument();
      expect(list.children).toHaveLength(0);
    });

    it("renders empty list when all channels are filtered out", () => {
      mockUseChannels.mockReturnValue({
        data: [makeChannel("ch1", "general")],
      });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      const input = screen.getByTestId("channel-search-input");
      fireEvent.change(input, { target: { value: "zzznomatch" } });

      const list = screen.getByRole("listbox");
      expect(list.children).toHaveLength(0);
    });
  });

  describe("undefined data", () => {
    it("handles undefined data gracefully (defaults to empty array)", () => {
      mockUseChannels.mockReturnValue({ data: undefined });

      render(
        <ForwardChannelList selectedChannelId={null} onSelect={vi.fn()} />,
      );

      const list = screen.getByRole("listbox");
      expect(list.children).toHaveLength(0);
    });
  });
});
