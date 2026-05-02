import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Message } from "@/types/im";

// Stub the forwarded card so this test doesn't drag in the entire forward
// rendering pipeline (router, query client, etc.). The integration of the
// real ForwardedMessageCard is covered by its own component test.
vi.mock("../forward/ForwardedMessageCard", () => ({
  ForwardedMessageCard: ({ message }: { message: Message }) => (
    <div data-testid="forwarded-card">forward-{message.id}</div>
  ),
}));

import { MessageContent } from "../MessageContent";

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseMessage = {
  id: "m-1",
  channelId: "ch-1",
  senderId: "u-1",
  content: "hello",
  contentAst: null,
  type: "text",
  metadata: null,
  isPinned: false,
  isEdited: false,
  isDeleted: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Message;

describe("MessageContent — forward dispatch", () => {
  it("renders ForwardedMessageCard for forward-type messages", () => {
    const fwdMessage = {
      ...baseMessage,
      id: "fwd-1",
      type: "forward",
      forward: {
        kind: "single",
        count: 1,
        sourceChannelId: "ch-2",
        sourceChannelName: "src",
        truncated: false,
        items: [],
      },
    } as unknown as Message;

    renderWithProviders(<MessageContent content="" message={fwdMessage} />);
    expect(screen.getByTestId("forwarded-card")).toHaveTextContent(
      "forward-fwd-1",
    );
  });

  it("does not render ForwardedMessageCard for non-forward messages", () => {
    renderWithProviders(<MessageContent content="hi" message={baseMessage} />);
    expect(screen.queryByTestId("forwarded-card")).toBeNull();
  });

  it("does not render ForwardedMessageCard when message prop is omitted", () => {
    renderWithProviders(<MessageContent content="hi" />);
    expect(screen.queryByTestId("forwarded-card")).toBeNull();
  });
});
