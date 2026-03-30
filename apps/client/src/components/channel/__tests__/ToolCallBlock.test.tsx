import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCallBlock } from "../ToolCallBlock";
import type { AgentEventMetadata } from "@/types/im";

function makeCallMeta(toolName: string): AgentEventMetadata {
  return {
    agentEventType: "tool_call",
    status: "completed",
    toolName,
    toolCallId: "tc-1",
  };
}

function makeResultMeta(
  status: "completed" | "failed" = "completed",
): AgentEventMetadata {
  return {
    agentEventType: "tool_result",
    status,
    success: status === "completed",
    toolCallId: "tc-1",
  };
}

describe("ToolCallBlock", () => {
  it("renders tool name from call metadata", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("SearchFiles")}
        resultMetadata={makeResultMeta()}
        resultContent='{"found": true}'
      />,
    );

    expect(screen.getByText("SearchFiles")).toBeInTheDocument();
    expect(screen.getByText("Calling")).toBeInTheDocument();
  });

  it("shows success indicator (checkmark) for completed result", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("ReadFile")}
        resultMetadata={makeResultMeta("completed")}
        resultContent="file contents"
      />,
    );

    expect(screen.getByText("\u2714")).toBeInTheDocument();
  });

  it("shows failure indicator (cross) for failed result", () => {
    const { container } = render(
      <ToolCallBlock
        callMetadata={makeCallMeta("RunScript")}
        resultMetadata={makeResultMeta("failed")}
        resultContent="permission denied"
      />,
    );

    expect(screen.getByText("\u2718")).toBeInTheDocument();
    // Red status dot for failure
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("shows result summary when collapsed", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent="short result"
      />,
    );

    // Summary line visible with Result label
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("short result")).toBeInTheDocument();
  });

  it("truncates long result summary to 80 chars", () => {
    const longContent = "x".repeat(100);
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent={longContent}
      />,
    );

    expect(screen.getByText("x".repeat(80) + " ...")).toBeInTheDocument();
  });

  it("shows full result content when expanded", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent="visible result content"
      />,
    );

    // Click to expand
    fireEvent.click(screen.getByText("Calling"));
    // Full content in expanded block
    expect(
      screen.getAllByText("visible result content").length,
    ).toBeGreaterThanOrEqual(1);
    // Result label still visible in expanded state
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("collapses back to summary on second click", () => {
    render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Search")}
        resultMetadata={makeResultMeta()}
        resultContent="toggle content"
      />,
    );

    const label = screen.getByText("Calling");

    // Expand — Result label stays visible
    fireEvent.click(label);
    expect(screen.getByText("Result")).toBeInTheDocument();

    // Collapse — summary reappears
    fireEvent.click(label);
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("toggle content")).toBeInTheDocument();
  });

  it("falls back to 'Unknown tool' when toolName is missing", () => {
    const meta: AgentEventMetadata = {
      agentEventType: "tool_call",
      status: "completed",
      toolCallId: "tc-1",
      // no toolName
    };
    render(
      <ToolCallBlock
        callMetadata={meta}
        resultMetadata={makeResultMeta()}
        resultContent="result"
      />,
    );

    expect(screen.getByText("Unknown tool")).toBeInTheDocument();
  });

  it("uses green status dot for successful result", () => {
    const { container } = render(
      <ToolCallBlock
        callMetadata={makeCallMeta("Tool")}
        resultMetadata={makeResultMeta("completed")}
        resultContent="ok"
      />,
    );

    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
    expect(container.querySelector(".bg-red-500")).not.toBeInTheDocument();
  });
});
