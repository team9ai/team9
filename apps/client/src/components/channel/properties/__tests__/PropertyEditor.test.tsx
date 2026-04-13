import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PropertyDefinition } from "@/types/properties";

// ==================== Mocks ====================

vi.mock("@/hooks/usePropertyDefinitions", () => ({
  useUpdatePropertyDefinition: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({
    data: [
      {
        userId: "user-1",
        user: {
          displayName: "Alice",
          username: "alice",
          avatarUrl: null,
        },
      },
      {
        userId: "user-2",
        user: {
          displayName: "Bob",
          username: "bob",
          avatarUrl: null,
        },
      },
    ],
  }),
}));

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({ userId }: { userId: string }) => (
    <span data-testid={`avatar-${userId}`}>{userId}</span>
  ),
}));

// ==================== Helpers ====================

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

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = createQueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Import after mocks
import { PropertyEditor } from "../PropertyEditor";

// ==================== Tests ====================

describe("PropertyEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a text input for text valueType and fires onChange", async () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "text" })}
        value="hello"
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText("Enter text...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("hello");

    fireEvent.change(input, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("renders a number input for number valueType", () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "number" })}
        value={42}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText("Enter number...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveValue(42);
  });

  it("renders a switch for boolean valueType and toggles", async () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "boolean" })}
        value={true}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const switchEl = screen.getByRole("switch");
    expect(switchEl).toBeInTheDocument();
    expect(switchEl).toHaveAttribute("aria-checked", "true");

    fireEvent.click(switchEl);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("handles false value correctly for boolean (not treated as empty)", () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "boolean" })}
        value={false}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const switchEl = screen.getByRole("switch");
    expect(switchEl).toHaveAttribute("aria-checked", "false");
  });

  it("renders select trigger for single_select valueType", () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({
          valueType: "single_select",
          config: {
            options: [
              { value: "opt1", label: "Option 1" },
              { value: "opt2", label: "Option 2" },
            ],
          },
        })}
        value="opt1"
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    // The select editor renders a button trigger
    expect(screen.getByText("Option 1")).toBeInTheDocument();
  });

  it("renders person picker with member list", () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({
          valueType: "person",
          channelId: "ch-1",
        })}
        value={["user-1"]}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    // Person picker displays selected members
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders date input for date valueType", () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "date" })}
        value="2026-04-01"
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByDisplayValue("2026-04-01");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "date");
  });

  it("renders url input for url valueType", async () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "url" })}
        value="https://example.com"
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText("https://...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("https://example.com");

    fireEvent.change(input, { target: { value: "https://test.com" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("fires onChange for number input with valid number", async () => {
    const onChange = vi.fn();
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "number" })}
        value={null}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText("Enter number...");
    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("renders disabled input when disabled prop is true", () => {
    render(
      <PropertyEditor
        definition={makeDefinition({ valueType: "text" })}
        value=""
        onChange={vi.fn()}
        disabled
      />,
      { wrapper: Wrapper },
    );

    const input = screen.getByPlaceholderText("Enter text...");
    expect(input).toBeDisabled();
  });
});
