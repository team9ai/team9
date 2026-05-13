import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { AgentEventMetadata, Message } from "@/types/im";
import { A2UISurfaceBlock } from "../A2UISurfaceBlock";

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({
    data: {
      id: "current-user",
      displayName: "Winrey Ma",
      username: "winrey",
    },
  }),
}));

vi.mock("@/hooks/useMessages", () => ({
  useSendMessage: () => ({ isPending: false, mutate: vi.fn() }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeCreateSurface(surfaceId = "choices-1") {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId: "cat-1", sendDataModel: true },
  };
}

function makeMultiTabPayload() {
  return [
    makeCreateSurface(),
    {
      version: "v0.9",
      updateComponents: {
        components: [
          { id: "root", type: "Column", children: ["tabs", "submit"] },
          {
            id: "tabs",
            type: "Tabs",
            tabs: [
              { title: "颜色", child: "tab-0" },
              { title: "水果", child: "tab-1" },
              { title: "心情", child: "tab-2" },
            ],
          },
          {
            id: "tab-0",
            type: "Column",
            children: ["tab-0-prompt", "tab-0-picker"],
          },
          {
            id: "tab-0-prompt",
            type: "Text",
            text: "选一个颜色：",
            variant: "h3",
          },
          {
            id: "tab-0-picker",
            type: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [
              { label: "红色", value: "red" },
              { label: "蓝色", value: "blue" },
            ],
          },
          {
            id: "tab-1",
            type: "Column",
            children: ["tab-1-prompt", "tab-1-picker"],
          },
          {
            id: "tab-1-prompt",
            type: "Text",
            text: "选一个水果：",
            variant: "h3",
          },
          {
            id: "tab-1-picker",
            type: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [
              { label: "苹果", value: "apple" },
              { label: "香蕉", value: "banana" },
            ],
          },
          {
            id: "tab-2",
            type: "Column",
            children: ["tab-2-prompt", "tab-2-picker"],
          },
          {
            id: "tab-2-prompt",
            type: "Text",
            text: "选一个心情：",
            variant: "h3",
          },
          {
            id: "tab-2-picker",
            type: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [
              { label: "开心", value: "happy" },
              { label: "平静", value: "calm" },
            ],
          },
          { id: "submit", type: "Button", label: "Submit" },
        ],
      },
    },
  ];
}

function makeMixedTabPayload() {
  return [
    makeCreateSurface(),
    {
      version: "v0.9",
      updateComponents: {
        components: [
          { id: "root", type: "Column", children: ["tabs", "submit"] },
          {
            id: "tabs",
            type: "Tabs",
            tabs: [
              { title: "颜色", child: "tab-0" },
              { title: "水果", child: "tab-1" },
            ],
          },
          {
            id: "tab-0",
            type: "Column",
            children: ["tab-0-prompt", "tab-0-picker"],
          },
          {
            id: "tab-0-prompt",
            type: "Text",
            text: "选一个颜色：",
            variant: "h3",
          },
          {
            id: "tab-0-picker",
            type: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [
              { label: "红色", value: "red" },
              { label: "蓝色", value: "blue" },
            ],
          },
          {
            id: "tab-1",
            type: "Column",
            children: ["tab-1-prompt", "tab-1-picker"],
          },
          {
            id: "tab-1-prompt",
            type: "Text",
            text: "可以多选水果：",
            variant: "h3",
          },
          {
            id: "tab-1-picker",
            type: "ChoicePicker",
            variant: "multipleSelection",
            options: [
              { label: "苹果", value: "apple" },
              { label: "香蕉", value: "banana" },
            ],
          },
          { id: "submit", type: "Button", label: "Submit" },
        ],
      },
    },
  ];
}

function renderSurface() {
  return renderSurfaceWithPayload(makeMultiTabPayload());
}

function renderSurfaceWithPayload(
  payload: AgentEventMetadata["payload"],
  metadataOverride: Partial<AgentEventMetadata> = {},
) {
  const message: Message = {
    id: "surface-message",
    channelId: "ch-1",
    senderId: "agent-1",
    content: "Interactive choices",
    type: "text",
    metadata: {},
    isPinned: false,
    isEdited: false,
    isDeleted: false,
    createdAt: "2026-05-13T02:00:00.000Z",
    updatedAt: "2026-05-13T02:00:00.000Z",
    sender: {
      id: "agent-1",
      email: "lia@example.com",
      username: "lia",
      displayName: "Lia",
      status: "online",
      isActive: true,
      userType: "bot",
      createdAt: "2026-05-13T02:00:00.000Z",
      updatedAt: "2026-05-13T02:00:00.000Z",
    },
  };
  const metadata: AgentEventMetadata = {
    agentEventType: "a2ui_surface_update",
    status: "running",
    surfaceId: "choices-1",
    payload,
    ...metadataOverride,
  };

  return render(
    <Wrapper>
      <A2UISurfaceBlock
        message={message}
        metadata={metadata}
        channelId="ch-1"
      />
    </Wrapper>,
  );
}

describe("A2UISurfaceBlock", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the active question header aligned as text", () => {
    renderSurface();

    const agentLabel = screen.getByText("Lia(agent)");

    expect(agentLabel).toBeInTheDocument();
    expect(agentLabel.parentElement).toHaveClass(
      "cursor-pointer",
      "hover:underline",
    );
    expect(screen.getByText(/asked you/)).toBeInTheDocument();
  });

  it("renders resolved surfaces with translated chrome and untranslated payload text", () => {
    renderSurfaceWithPayload(makeMultiTabPayload(), {
      status: "resolved",
      selections: {
        颜色: { selected: ["blue"], otherText: null },
      },
      responderId: "current-user",
      responderName: "Winrey Ma",
    });

    const agentLabel = screen.getByText("Lia(agent)");
    const userLabel = screen.getByText("Winrey Ma(you)");

    expect(agentLabel).toBeInTheDocument();
    expect(agentLabel.parentElement).toHaveClass(
      "cursor-pointer",
      "hover:underline",
    );
    expect(screen.getByText(/asked/)).toBeInTheDocument();
    expect(screen.getByText("“颜色 / 水果 / 心情”")).toBeInTheDocument();
    expect(screen.getByText(/answered by/)).toBeInTheDocument();
    expect(userLabel).toBeInTheDocument();
    expect(userLabel.parentElement).toHaveClass(
      "cursor-pointer",
      "hover:underline",
    );
    expect(screen.getByText(/selected/)).toBeInTheDocument();
    expect(screen.getByText("“蓝色”")).toBeInTheDocument();
    expect(screen.getByText("Click to expand")).toBeInTheDocument();
  });

  it("auto-advances after an unanswered single-select tab receives its first selection", () => {
    renderSurface();

    expect(screen.getByText("选一个颜色：")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("蓝色"));

    expect(screen.getByText("选一个水果：")).toBeInTheDocument();
  });

  it("uses next while unanswered tabs remain and submit once all tabs are answered", () => {
    renderSurface();

    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("蓝色"));
    expect(screen.getByText("选一个水果：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("香蕉"));
    expect(screen.getByText("选一个心情：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("开心"));
    expect(screen.getByText("选一个心情：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("disables the primary action until the current tab has a selection", () => {
    renderSurface();

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("蓝色"));
    expect(screen.getByText("选一个水果：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("香蕉"));
    expect(screen.getByText("选一个心情：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("开心"));
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("keeps multi-select tabs in place until the user clicks next", () => {
    renderSurfaceWithPayload(makeMixedTabPayload());

    fireEvent.click(screen.getByLabelText("蓝色"));
    expect(screen.getByText("可以多选水果：")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("苹果"));
    expect(screen.getByText("可以多选水果：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("keeps unanswered tabs in place with a disabled primary action", () => {
    renderSurface();

    fireEvent.click(screen.getByRole("button", { name: "心情" }));

    expect(screen.getByText("选一个心情：")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
