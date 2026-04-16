import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AiAutoFillButton } from "../AiAutoFillButton";

const autoFillMock = vi.fn();

vi.mock("@/services/api/properties", () => ({
  aiAutoFillApi: {
    autoFill: (...args: unknown[]) => autoFillMock(...args),
  },
}));

describe("AiAutoFillButton", () => {
  beforeEach(() => {
    autoFillMock.mockReset();
  });

  it("shows a 'Nothing to fill' badge when the AI returns an empty filled map, then auto-dismisses", async () => {
    autoFillMock.mockResolvedValue({ filled: {}, skipped: [] });

    render(
      <AiAutoFillButton messageId="msg-1" channelId="chan-1" size="default" />,
    );

    fireEvent.click(screen.getByTitle("AI Generate"));

    await waitFor(() => {
      expect(screen.getByText("Nothing to fill")).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.queryByText("Nothing to fill")).not.toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("does NOT show 'Nothing to fill' when AI actually fills fields", async () => {
    autoFillMock.mockResolvedValue({
      filled: { status: "open" },
      skipped: [],
    });

    render(
      <AiAutoFillButton messageId="msg-1" channelId="chan-1" size="default" />,
    );

    fireEvent.click(screen.getByTitle("AI Generate"));

    await waitFor(() => {
      expect(autoFillMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Nothing to fill")).not.toBeInTheDocument();
  });

  it("surfaces an 'AI failed' error badge when the request rejects", async () => {
    autoFillMock.mockRejectedValue(new Error("boom"));

    render(
      <AiAutoFillButton messageId="msg-1" channelId="chan-1" size="default" />,
    );

    fireEvent.click(screen.getByTitle("AI Generate"));

    await waitFor(() => {
      expect(screen.getByText("AI failed")).toBeInTheDocument();
    });
  });

  it("sends preserveExisting=true and forwards the fields prop", async () => {
    autoFillMock.mockResolvedValue({ filled: { a: 1 }, skipped: [] });

    render(
      <AiAutoFillButton
        messageId="msg-42"
        channelId="chan-1"
        fields={["a", "b"]}
      />,
    );

    fireEvent.click(screen.getByTitle("AI Generate"));

    await waitFor(() => {
      expect(autoFillMock).toHaveBeenCalledWith("msg-42", {
        fields: ["a", "b"],
        preserveExisting: true,
      });
    });
  });
});
