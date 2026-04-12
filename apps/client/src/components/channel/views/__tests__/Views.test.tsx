import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  ChannelView,
  PropertyDefinition,
  ViewMessageItem,
} from "@/types/properties";

// Polyfill IntersectionObserver for jsdom
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor() {}
}
Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

// ==================== Shared test data factories ====================

function makeDefinition(
  overrides: Partial<PropertyDefinition> = {},
): PropertyDefinition {
  return {
    id: "def-1",
    channelId: "ch-1",
    key: "status",
    description: null,
    valueType: "text",
    isNative: false,
    config: {},
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
    ...overrides,
  };
}

function makeView(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    id: "view-1",
    channelId: "ch-1",
    name: "Test View",
    type: "table",
    config: {},
    order: 0,
    createdBy: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeViewMessage(
  overrides: Partial<ViewMessageItem> = {},
): ViewMessageItem {
  return {
    id: "msg-1",
    channelId: "ch-1",
    senderId: "user-1",
    parentId: null,
    rootId: null,
    content: "<p>Hello world</p>",
    type: "text",
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    properties: {},
    ...overrides,
  };
}

// ==================== Mock data holders ====================

let mockDefinitions: PropertyDefinition[] = [];
let mockViewMessagesFlat: ViewMessageItem[] = [];
let mockViewMessagesGrouped: {
  groups: { groupKey: string; messages: ViewMessageItem[]; total: number }[];
  total: number;
} | null = null;
const mockUpdateView = { mutate: vi.fn(), isPending: false };
const mockSendMessage = { mutateAsync: vi.fn(), isPending: false };

// ==================== Mocks ====================

vi.mock("@/hooks/usePropertyDefinitions", () => ({
  usePropertyDefinitions: () => ({ data: mockDefinitions }),
}));

vi.mock("@/hooks/useChannelViews", () => ({
  useViewMessagesInfinite: () => ({
    data: {
      pages: [
        {
          messages: mockViewMessagesFlat,
          total: mockViewMessagesFlat.length,
          cursor: null,
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useViewMessages: () => ({
    data: mockViewMessagesGrouped ?? {
      messages: mockViewMessagesFlat,
      total: mockViewMessagesFlat.length,
      cursor: null,
    },
    isLoading: false,
  }),
  useUpdateView: () => mockUpdateView,
  channelViewKeys: {
    all: (channelId: string) => ["channel", channelId, "views"],
    messages: (channelId: string, viewId: string) => [
      "channel",
      channelId,
      "views",
      viewId,
      "messages",
    ],
  },
}));

vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => mockSendMessage,
}));

vi.mock("@/hooks/useMessageProperties", () => ({
  useSetProperty: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({ data: { id: "user-1" } }),
}));

vi.mock("@/services/api/im", () => ({
  messagesApi: {
    sendMessage: vi.fn().mockResolvedValue({ id: "new-msg" }),
  },
}));

vi.mock("@/services/api/properties", () => ({
  messagePropertiesApi: {
    setProperty: vi.fn().mockResolvedValue({ success: true }),
    batchSetProperties: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({ userId }: { userId: string }) => (
    <span data-testid={`avatar-${userId}`}>{userId}</span>
  ),
}));

vi.mock("../ViewConfigPanel", () => ({
  ViewConfigPanel: () => <div data-testid="view-config-panel" />,
}));

vi.mock("@/components/channel/properties/AiAutoFillButton", () => ({
  AiAutoFillButton: () => <button data-testid="ai-btn">AI</button>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange: _onValueChange }: any) => (
    <div data-testid="select-root">{children}</div>
  ),
  SelectTrigger: ({ children }: any) => (
    <button data-testid="select-trigger">{children}</button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-value={value}>{children}</div>
  ),
}));

// ==================== Test setup ====================

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Import after mocks
import { TableView } from "../TableView";
import { BoardView } from "../BoardView";
import { CalendarView } from "../CalendarView";

// ==================== TableView Tests ====================

describe("TableView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockDefinitions = [];
    mockViewMessagesFlat = [];
    mockViewMessagesGrouped = null;
  });

  it("renders header and rows", () => {
    mockDefinitions = [
      makeDefinition({ id: "def-1", key: "status", valueType: "text" }),
    ];
    mockViewMessagesFlat = [
      makeViewMessage({ id: "msg-1", content: "<p>First message</p>" }),
      makeViewMessage({ id: "msg-2", content: "<p>Second message</p>" }),
    ];

    render(<TableView channelId="ch-1" view={makeView()} />, {
      wrapper: Wrapper,
    });

    // Header columns
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();

    // Row content
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("shows content column with truncated preview", () => {
    const longContent = "<p>" + "A".repeat(100) + "</p>";
    mockViewMessagesFlat = [
      makeViewMessage({ id: "msg-1", content: longContent }),
    ];

    render(<TableView channelId="ch-1" view={makeView()} />, {
      wrapper: Wrapper,
    });

    // Content is truncated to 80 chars + "..."
    const expected = "A".repeat(80) + "...";
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows empty state when no messages", () => {
    mockViewMessagesFlat = [];

    render(<TableView channelId="ch-1" view={makeView()} />, {
      wrapper: Wrapper,
    });

    expect(
      screen.getByText("No messages match the current view configuration."),
    ).toBeInTheDocument();
  });
});

// ==================== BoardView Tests ====================

describe("BoardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockDefinitions = [];
    mockViewMessagesFlat = [];
    mockViewMessagesGrouped = null;
  });

  it("renders columns grouped by property", () => {
    const statusDef = makeDefinition({
      id: "def-status",
      key: "status",
      valueType: "single_select",
      config: {
        options: [
          { value: "open", label: "Open", color: "#22c55e" },
          { value: "closed", label: "Closed", color: "#ef4444" },
        ],
      },
    });
    mockDefinitions = [statusDef];

    mockViewMessagesGrouped = {
      groups: [
        {
          groupKey: "open",
          messages: [
            makeViewMessage({
              id: "msg-1",
              content: "<p>Open task</p>",
              properties: { status: "open" },
            }),
          ],
          total: 1,
        },
        {
          groupKey: "closed",
          messages: [
            makeViewMessage({
              id: "msg-2",
              content: "<p>Closed task</p>",
              properties: { status: "closed" },
            }),
          ],
          total: 1,
        },
      ],
      total: 2,
    };

    render(
      <BoardView
        channelId="ch-1"
        view={makeView({ type: "board", config: { groupBy: "status" } })}
      />,
      { wrapper: Wrapper },
    );

    // Column headers
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();

    // Cards
    expect(screen.getByText("Open task")).toBeInTheDocument();
    expect(screen.getByText("Closed task")).toBeInTheDocument();
  });

  it("renders cards with property chips", () => {
    const statusDef = makeDefinition({
      id: "def-status",
      key: "status",
      valueType: "single_select",
      config: {
        options: [{ value: "open", label: "Open" }],
      },
    });
    const priorityDef = makeDefinition({
      id: "def-priority",
      key: "priority",
      valueType: "number",
      order: 1,
    });
    mockDefinitions = [statusDef, priorityDef];

    mockViewMessagesGrouped = {
      groups: [
        {
          groupKey: "open",
          messages: [
            makeViewMessage({
              id: "msg-1",
              content: "<p>Task with props</p>",
              properties: { status: "open", priority: 5 },
            }),
          ],
          total: 1,
        },
      ],
      total: 1,
    };

    render(
      <BoardView
        channelId="ch-1"
        view={makeView({ type: "board", config: { groupBy: "status" } })}
      />,
      { wrapper: Wrapper },
    );

    // Card content
    expect(screen.getByText("Task with props")).toBeInTheDocument();
    // Priority chip (not status, since status is the groupBy column)
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows empty state when no groups and groupBy is set but no data", () => {
    mockDefinitions = [
      makeDefinition({
        id: "def-status",
        key: "status",
        valueType: "single_select",
        config: {
          options: [{ value: "open", label: "Open" }],
        },
      }),
    ];
    mockViewMessagesFlat = [];
    // Return empty grouped response
    mockViewMessagesGrouped = { groups: [], total: 0 };

    render(
      <BoardView
        channelId="ch-1"
        view={makeView({ type: "board", config: { groupBy: "status" } })}
      />,
      { wrapper: Wrapper },
    );

    expect(
      screen.getByText("No messages match the current view configuration."),
    ).toBeInTheDocument();
  });
});

// ==================== CalendarView Tests ====================

describe("CalendarView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    mockDefinitions = [];
    mockViewMessagesFlat = [];
    mockViewMessagesGrouped = null;
  });

  it("renders month grid with 7 day-name columns", () => {
    mockDefinitions = [
      makeDefinition({
        id: "def-date",
        key: "due_date",
        valueType: "date",
      }),
    ];

    render(
      <CalendarView
        channelId="ch-1"
        view={makeView({
          type: "calendar",
          config: { groupBy: "due_date" },
        })}
      />,
      { wrapper: Wrapper },
    );

    // 7 day name headers
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const name of dayNames) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("renders mode toggle buttons for month/week/day", () => {
    mockDefinitions = [
      makeDefinition({
        id: "def-date",
        key: "due_date",
        valueType: "date",
      }),
    ];

    render(
      <CalendarView
        channelId="ch-1"
        view={makeView({
          type: "calendar",
          config: { groupBy: "due_date" },
        })}
      />,
      { wrapper: Wrapper },
    );

    // ModeToggle renders lowercase text with CSS capitalize
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getByText("week")).toBeInTheDocument();
    expect(screen.getByText("day")).toBeInTheDocument();
  });

  it("renders navigation controls (prev, today, next)", () => {
    mockDefinitions = [
      makeDefinition({
        id: "def-date",
        key: "due_date",
        valueType: "date",
      }),
    ];

    render(
      <CalendarView
        channelId="ch-1"
        view={makeView({
          type: "calendar",
          config: { groupBy: "due_date" },
        })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
  });
});
