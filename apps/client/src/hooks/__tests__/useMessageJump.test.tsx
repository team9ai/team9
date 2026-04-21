import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMessageJump } from "../useMessageJump";
import type { ChannelTab } from "@/types/properties";

function makeTab(overrides: Partial<ChannelTab>): ChannelTab {
  return {
    id: "tab-1",
    channelId: "ch-1",
    name: "Messages",
    type: "messages",
    viewId: null,
    isBuiltin: true,
    order: 0,
    createdBy: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("useMessageJump", () => {
  it("switches to messages tab and sets highlight on jump", () => {
    const setActiveTabId = vi.fn();
    const tabs: ChannelTab[] = [
      makeTab({ id: "messages-tab", type: "messages" }),
      makeTab({ id: "table-tab", type: "table_view" }),
    ];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    expect(result.current.highlightId).toBeUndefined();
    expect(result.current.seq).toBe(0);

    act(() => {
      result.current.jumpToMessage("msg-1");
    });

    expect(setActiveTabId).toHaveBeenCalledWith("messages-tab");
    expect(result.current.highlightId).toBe("msg-1");
    expect(result.current.seq).toBe(1);
  });

  it("bumps seq on repeat click of same message", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));
    act(() => result.current.jumpToMessage("msg-1"));

    expect(result.current.highlightId).toBe("msg-1");
    expect(result.current.seq).toBe(2);
  });

  it("updates highlightId when jumping to a different message", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));
    act(() => result.current.jumpToMessage("msg-2"));

    expect(result.current.highlightId).toBe("msg-2");
    expect(result.current.seq).toBe(2);
  });

  it("is a no-op when no messages tab exists", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "table-tab", type: "table_view" })];

    const { result } = renderHook(() => useMessageJump(tabs, setActiveTabId));

    act(() => result.current.jumpToMessage("msg-1"));

    expect(setActiveTabId).not.toHaveBeenCalled();
    expect(result.current.highlightId).toBeUndefined();
    expect(result.current.seq).toBe(0);
  });

  it("returns a stable jumpToMessage reference across renders", () => {
    const setActiveTabId = vi.fn();
    const tabs = [makeTab({ id: "messages-tab", type: "messages" })];

    const { result, rerender } = renderHook(
      ({ tabList }) => useMessageJump(tabList, setActiveTabId),
      { initialProps: { tabList: tabs } },
    );

    const first = result.current.jumpToMessage;
    rerender({ tabList: tabs });
    expect(result.current.jumpToMessage).toBe(first);
  });
});
