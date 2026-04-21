import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PropertyDefinition, MessageRefConfig } from "@/types/properties";

// ==================== Mocks ====================

const mockSearchMessages = vi.fn();

vi.mock("@/services/api/search", () => ({
  searchApi: {
    searchMessages: (...args: unknown[]) => mockSearchMessages(...args),
  },
}));

// ==================== Helpers ====================

function makeDefinition(
  configOverrides: Partial<MessageRefConfig> = {},
  defOverrides: Partial<PropertyDefinition> = {},
): PropertyDefinition {
  return {
    id: "def-1",
    channelId: "ch-default",
    key: "linked_message",
    description: null,
    valueType: "message_ref",
    isNative: false,
    config: configOverrides as Record<string, unknown>,
    order: 0,
    aiAutoFill: false,
    aiAutoFillPrompt: null,
    isRequired: false,
    defaultValue: null,
    showInChatPolicy: "auto",
    allowNewOptions: false,
    createdBy: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...defOverrides,
  };
}

function makeSearchResult(id: string, content: string) {
  return {
    items: [
      {
        id,
        type: "message" as const,
        score: 1,
        highlight: content,
        data: {
          id,
          channelId: "ch-1",
          channelName: "general",
          senderId: "user-1",
          senderUsername: "alice",
          senderDisplayName: "Alice",
          content,
          messageType: "text",
          hasAttachment: false,
          isPinned: false,
          isThreadReply: false,
          createdAt: "2026-04-01T00:00:00Z",
        },
      },
    ],
    total: 1,
    hasMore: false,
  };
}

function makeMultiSearchResult(
  messages: Array<{ id: string; content: string }>,
) {
  return {
    items: messages.map(({ id, content }) => ({
      id,
      type: "message" as const,
      score: 1,
      highlight: content,
      data: {
        id,
        channelId: "ch-1",
        channelName: "general",
        senderId: "user-1",
        senderUsername: "alice",
        senderDisplayName: "Alice",
        content,
        messageType: "text",
        hasAttachment: false,
        isPinned: false,
        isThreadReply: false,
        createdAt: "2026-04-01T00:00:00Z",
      },
    })),
    total: messages.length,
    hasMore: false,
  };
}

/** Helper that types in the combobox and flushes the debounce using real timers */
async function typeAndSearch(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  // Wait for the real 300ms debounce + microtasks to resolve
  await new Promise((r) => setTimeout(r, 400));
}

// Import after mocks
import { MessageRefPicker } from "../editors/MessageRefPicker";

// ==================== Tests ====================

describe("MessageRefPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── scope ────────────────────────────────────────────────────────────────

  it("does not pass channelId when scope is not same_channel", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m1", "hello"));

    render(
      <MessageRefPicker
        definition={makeDefinition({})}
        value={null}
        onChange={vi.fn()}
        channelId="c1"
        currentMessageId="m99"
      />,
    );

    await typeAndSearch("hi");

    expect(mockSearchMessages).toHaveBeenCalledWith(
      "hi",
      expect.not.objectContaining({ channelId: "c1" }),
    );
  });

  it("passes channelId when scope=same_channel (from channelId prop)", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m1", "hello"));

    render(
      <MessageRefPicker
        definition={makeDefinition({ scope: "same_channel" })}
        value={null}
        onChange={vi.fn()}
        channelId="c1"
        currentMessageId="m99"
      />,
    );

    await typeAndSearch("hi");

    expect(mockSearchMessages).toHaveBeenCalledWith(
      "hi",
      expect.objectContaining({ channelId: "c1" }),
    );
  });

  it("falls back to definition.channelId when channelId prop missing and scope=same_channel", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m1", "hello"));

    render(
      <MessageRefPicker
        definition={makeDefinition(
          { scope: "same_channel" },
          { channelId: "ch-from-def" },
        )}
        value={null}
        onChange={vi.fn()}
        currentMessageId="m99"
      />,
    );

    await typeAndSearch("hi");

    expect(mockSearchMessages).toHaveBeenCalledWith(
      "hi",
      expect.objectContaining({ channelId: "ch-from-def" }),
    );
  });

  // ── self-exclusion ────────────────────────────────────────────────────────

  it("excludes current message from displayed results", async () => {
    mockSearchMessages.mockResolvedValue(
      makeMultiSearchResult([
        { id: "m1", content: "self message" },
        { id: "m2", content: "other message" },
      ]),
    );

    render(
      <MessageRefPicker
        definition={makeDefinition()}
        value={null}
        onChange={vi.fn()}
        currentMessageId="m1"
      />,
    );

    await typeAndSearch("anything");

    await waitFor(() =>
      expect(screen.getByText("other message")).toBeInTheDocument(),
    );
    expect(screen.queryByText("self message")).not.toBeInTheDocument();
  });

  it("shows all results when no currentMessageId set", async () => {
    mockSearchMessages.mockResolvedValue(
      makeMultiSearchResult([
        { id: "m1", content: "first" },
        { id: "m2", content: "second" },
      ]),
    );

    render(
      <MessageRefPicker
        definition={makeDefinition()}
        value={null}
        onChange={vi.fn()}
      />,
    );

    await typeAndSearch("q");

    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
      expect(screen.getByText("second")).toBeInTheDocument();
    });
  });

  // ── single cardinality ────────────────────────────────────────────────────

  it("single cardinality: onChange called with scalar string id", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m2", "new result"));
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "single" })}
        value={null}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    await typeAndSearch("q");

    await waitFor(() =>
      expect(screen.getByText("new result")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("new result"));

    expect(onChange).toHaveBeenCalledWith("m2");
    expect(onChange).not.toHaveBeenCalledWith(expect.any(Array));
  });

  it("single cardinality: dropdown closes after selection (aria-expanded=false)", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m2", "pick me"));
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "single" })}
        value={null}
        onChange={onChange}
      />,
    );

    await typeAndSearch("pick");

    await waitFor(() =>
      expect(screen.getByText("pick me")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("pick me"));

    // Dropdown item should disappear (dropdown closed)
    await waitFor(() =>
      expect(screen.queryByText("pick me")).not.toBeInTheDocument(),
    );
    // combobox is now collapsed (aria-expanded=false)
    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });

  it("single cardinality: clear button calls onChange(null)", () => {
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "single" })}
        value="old-id"
        onChange={onChange}
      />,
    );

    const clearBtn = screen.getByRole("button");
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // ── multi cardinality ─────────────────────────────────────────────────────

  it("multi cardinality: appends to existing array", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("b", "b message"));
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "multi" })}
        value={["a"]}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    await typeAndSearch("b");

    await waitFor(() =>
      expect(screen.getByText("b message")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("b message"));

    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("multi cardinality: combobox stays visible after selection", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("b", "b message"));
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "multi" })}
        value={["a"]}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    await typeAndSearch("b");

    await waitFor(() =>
      expect(screen.getByText("b message")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("b message"));

    // combobox stays mounted for additional selections
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("multi cardinality: removes a chip when X is clicked", () => {
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "multi" })}
        value={["x", "y"]}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    // First button is the first chip's remove button
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons[0]);

    // Should remove first id and keep the other
    expect(onChange).toHaveBeenCalledWith(["y"]);
  });

  it("multi cardinality: removing last chip calls onChange(null)", () => {
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "multi" })}
        value={["only"]}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    const removeButton = screen.getByRole("button");
    fireEvent.click(removeButton);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  // ── default cardinality (multi when config absent) ──────────────────────

  it("defaults to multi cardinality when config is empty (legacy compat)", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m2", "result"));
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({})}
        value={null}
        onChange={onChange}
      />,
    );

    await typeAndSearch("q");

    await waitFor(() => expect(screen.getByText("result")).toBeInTheDocument());

    fireEvent.click(screen.getByText("result"));

    // Default is multi → array call
    expect(onChange).toHaveBeenCalledWith(["m2"]);
  });

  it("multi cardinality keeps dropdown open after selection", async () => {
    mockSearchMessages.mockResolvedValue(
      makeMultiSearchResult([
        { id: "b", content: "b message" },
        { id: "c", content: "c message" },
      ]),
    );
    const onChange = vi.fn();

    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "multi" })}
        value={["a"]}
        onChange={onChange}
        currentMessageId="m1"
      />,
    );

    await typeAndSearch("search");

    await waitFor(() =>
      expect(screen.getByText("b message")).toBeInTheDocument(),
    );

    // Select first item
    fireEvent.click(screen.getByText("b message"));

    // Dropdown should still be open (c message still visible)
    // The combobox should still be present and aria-expanded should remain true
    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeInTheDocument();
    expect(combobox).toHaveAttribute("aria-expanded", "true");
  });

  // ── no search when query empty ────────────────────────────────────────────

  it("does not call API when search query is empty", async () => {
    render(
      <MessageRefPicker
        definition={makeDefinition()}
        value={null}
        onChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "" },
    });

    await new Promise((r) => setTimeout(r, 400));

    expect(mockSearchMessages).not.toHaveBeenCalled();
  });

  // ── disabled state ────────────────────────────────────────────────────────

  it("disables the input when disabled prop is true", () => {
    render(
      <MessageRefPicker
        definition={makeDefinition()}
        value={null}
        onChange={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("does not show remove button when disabled and single value is set", () => {
    render(
      <MessageRefPicker
        definition={makeDefinition({ cardinality: "single" })}
        value="some-id"
        onChange={vi.fn()}
        disabled
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // ── debounce ──────────────────────────────────────────────────────────────

  it("debounces search — only calls API once after 300ms quiet period", async () => {
    mockSearchMessages.mockResolvedValue(makeSearchResult("m1", "hello"));

    render(
      <MessageRefPicker
        definition={makeDefinition()}
        value={null}
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox");

    // Rapid changes within 300ms window
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    // Wait only 200ms — should not have been called yet
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(mockSearchMessages).not.toHaveBeenCalled();

    // Wait another 200ms (total 400ms) — should now be called once with final value
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalledTimes(1));
    expect(mockSearchMessages).toHaveBeenCalledWith("abc", expect.any(Object));
  });
});
