import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Message } from "@/types/im";

// ---------- mocks ----------

const mockUseFullContent = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock("@/hooks/useMessages", () => ({
  useFullContent: (...args: unknown[]) => mockUseFullContent(...args),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// ---------- import after mocks ----------

// We must import dynamically so vi.mock takes effect before module evaluation.
// However vitest hoists vi.mock calls, so static import is fine here.
import { LongTextCollapse } from "../LongTextCollapse";

// re-export the private helper via module internals — we test it indirectly
// through the rendered output AND directly by importing the module source.
// Since formatCharCount is not exported, we test it through rendered text.

// ---------- helpers ----------

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    content: "a".repeat(500),
    type: "long_text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    isTruncated: true,
    fullContentLength: 5000,
    ...overrides,
  };
}

function defaultFullContentReturn(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- tests ----------

describe("LongTextCollapse", () => {
  describe("collapsed state", () => {
    it("renders gradient overlay and expand button when collapsed", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage();

      const { container } = render(
        <LongTextCollapse message={msg}>
          <p>Preview text</p>
        </LongTextCollapse>,
      );

      // children visible
      expect(screen.getByText("Preview text")).toBeInTheDocument();

      // gradient overlay present (pointer-events-none div)
      const gradient = container.querySelector(".pointer-events-none");
      expect(gradient).toBeInTheDocument();

      // expand button present
      expect(
        screen.getByRole("button", { name: /展开全文/ }),
      ).toBeInTheDocument();
    });

    it('shows correct "还有约 X 字" count using formatCharCount', () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      // fullContentLength=5000, content length=500 → remaining=4500 → "4.5k"
      const msg = makeMessage({
        content: "a".repeat(500),
        fullContentLength: 5000,
      });

      render(
        <LongTextCollapse message={msg}>
          <p>text</p>
        </LongTextCollapse>,
      );

      expect(screen.getByText(/还有约 4\.5k 字/)).toBeInTheDocument();
    });
  });

  describe("formatCharCount via rendered output", () => {
    it("shows raw number under 1000", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({
        content: "a".repeat(100),
        fullContentLength: 800,
      });
      // remaining = 700

      render(
        <LongTextCollapse message={msg}>
          <p>text</p>
        </LongTextCollapse>,
      );

      expect(screen.getByText(/还有约 700 字/)).toBeInTheDocument();
    });

    it("shows 1 decimal k for 1000-9999 range", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({
        content: "a".repeat(200),
        fullContentLength: 3500,
      });
      // remaining = 3300 → "3.3k"

      render(
        <LongTextCollapse message={msg}>
          <p>text</p>
        </LongTextCollapse>,
      );

      expect(screen.getByText(/还有约 3\.3k 字/)).toBeInTheDocument();
    });

    it("shows rounded k for 10000+", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({
        content: "a".repeat(500),
        fullContentLength: 15500,
      });
      // remaining = 15000 → "15k"

      render(
        <LongTextCollapse message={msg}>
          <p>text</p>
        </LongTextCollapse>,
      );

      expect(screen.getByText(/还有约 15k 字/)).toBeInTheDocument();
    });

    it("does not show char count when fullContentLength is absent", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({ fullContentLength: undefined });

      render(
        <LongTextCollapse message={msg}>
          <p>text</p>
        </LongTextCollapse>,
      );

      const btn = screen.getByRole("button", { name: /展开全文/ });
      expect(btn.textContent).toBe("展开全文");
    });
  });

  describe("expand — not truncated (local content)", () => {
    it("immediately expands without triggering fetch", () => {
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({ isTruncated: false });

      const { container } = render(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));

      // useFullContent called with enabled=false (isTruncated is false)
      expect(mockUseFullContent).toHaveBeenCalledWith("msg-1", false);

      // expand button should disappear
      expect(
        screen.queryByRole("button", { name: /展开全文/ }),
      ).not.toBeInTheDocument();

      // gradient overlay gone
      expect(
        container.querySelector(".pointer-events-none"),
      ).not.toBeInTheDocument();
    });
  });

  describe("expand — truncated (needs fetch)", () => {
    it("enables fetch and shows loading state on click", () => {
      // First render: not loading
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({ isTruncated: true });

      const { rerender } = render(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));

      // After click, component re-renders — simulate loading state
      mockUseFullContent.mockReturnValue(
        defaultFullContentReturn({ isLoading: true }),
      );

      rerender(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      expect(screen.getByText("加载中...")).toBeInTheDocument();
      // expand button should be gone (fetchEnabled is true now)
      expect(
        screen.queryByRole("button", { name: /展开全文/ }),
      ).not.toBeInTheDocument();
    });

    it("auto-expands when full content data arrives", () => {
      mockUseFullContent.mockReturnValue(
        defaultFullContentReturn({ data: { content: "full text here" } }),
      );
      const msg = makeMessage({ isTruncated: true });

      const { container } = render(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      // The useEffect sees data and sets isExpanded=true
      // gradient overlay should be gone
      expect(
        container.querySelector(".pointer-events-none"),
      ).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows only retry button on error (not expand button)", () => {
      mockUseFullContent.mockReturnValue(
        defaultFullContentReturn({ isError: true }),
      );
      const msg = makeMessage({ isTruncated: true });

      // We need fetchEnabled=true for error to show. Simulate by clicking expand first.
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const { rerender } = render(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));

      // Now simulate error state
      mockUseFullContent.mockReturnValue(
        defaultFullContentReturn({ isError: true }),
      );
      rerender(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      // Retry button visible
      expect(
        screen.getByRole("button", { name: /加载失败，点击重试/ }),
      ).toBeInTheDocument();

      // Expand button NOT visible
      expect(
        screen.queryByRole("button", { name: /展开全文/ }),
      ).not.toBeInTheDocument();
    });

    it("clicking retry invalidates the query", () => {
      // Start with fetchEnabled by clicking expand first
      mockUseFullContent.mockReturnValue(defaultFullContentReturn());
      const msg = makeMessage({ isTruncated: true });

      const { rerender } = render(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));

      // Now error state
      mockUseFullContent.mockReturnValue(
        defaultFullContentReturn({ isError: true }),
      );
      rerender(
        <LongTextCollapse message={msg}>
          <p>content</p>
        </LongTextCollapse>,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /加载失败，点击重试/ }),
      );

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ["message-full-content", "msg-1"],
      });
    });
  });
});
