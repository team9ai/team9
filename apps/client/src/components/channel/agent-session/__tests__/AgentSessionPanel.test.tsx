import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionPanel } from "../AgentSessionPanel";

const binding = {
  channelId: "ch-1",
  channelType: "direct" as const,
  kind: "dm" as const,
  supported: true,
  tenantId: "tenant-1",
  agentId: "agent-1",
  botUserId: "bot-user-1",
  sessionId: "session-1",
  status: { exists: true, activityState: "active" as const, queueLength: 1 },
};

describe("AgentSessionPanel", () => {
  it("renders active binding and component data", () => {
    render(
      <AgentSessionPanel
        binding={binding}
        components={{
          sessionId: "session-1",
          components: [
            {
              id: "persona",
              typeKey: "persona",
              runtimeInjectedOnly: false,
              latestData: {
                data: { mood: "focused" },
                capturedAtCallId: null,
                capturedAt: 1700000000000,
              },
            },
          ],
        }}
        isLoading={false}
        isError={false}
        width={360}
        onWidthChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Agent Session")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("persona")).toBeInTheDocument();
    expect(screen.getByText(/focused/)).toBeInTheDocument();
  });

  it("renders unsupported fallback", () => {
    render(
      <AgentSessionPanel
        binding={{
          ...binding,
          supported: false,
          kind: null,
          sessionId: null,
          unsupportedReason: "not_hive_managed",
        }}
        components={undefined}
        isLoading={false}
        isError={false}
        width={360}
        onWidthChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Runtime details unavailable")).toBeInTheDocument();
    expect(screen.getByText("not_hive_managed")).toBeInTheDocument();
  });
});
