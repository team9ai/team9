import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PermissionRequestCard } from "../PermissionRequestCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // Return human-readable strings for known keys
      const map: Record<string, string> = {
        "request.from": `From ${params?.bot ?? "bot"}`,
        "request.in": `in ${params?.channel ?? ""}`,
        "request.spellCopy": "Copy spell id",
        "request.allowOnce": "Allow once",
        "request.remember": "Allow & remember…",
        "request.deny": "Deny",
        "remember.subjectLabel": "Apply to",
        "remember.subjectAgent": "This agent",
        "remember.subjectChannel": "This channel only",
        "remember.subjectExecution": "This routine run only",
        "remember.subjectTask": "This routine (all runs)",
        "remember.expiresLabel": "Expires (optional)",
        "remember.save": "Save grant",
      };
      return map[key] ?? key;
    },
  }),
}));

const baseRequest = {
  id: "r1",
  spellId: "raven crystal flame",
  permissionKey: "messages:send" as const,
  requestedMetadata: { channelId: "c1" },
  reason: "post the daily summary",
  contextChannelId: "c1",
  requesterBotName: "Daily Bot",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("<PermissionRequestCard>", () => {
  it("shows the spell id and three action buttons", () => {
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    expect(screen.getByText("raven crystal flame")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /allow once/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remember/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("emits onDecide with decision=once", () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "once" });
  });

  it("emits onDecide with decision=deny", () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "deny" });
  });

  it("expands remember form and emits with overrides", () => {
    const onDecide = vi.fn();
    render(<PermissionRequestCard request={baseRequest} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /remember/i }));
    expect(screen.getByLabelText(/apply to/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save grant/i }));
    expect(onDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "remember",
        rememberSubject: "agent",
      }),
    );
  });

  it("copies spell id to clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /copy spell id/i }));
    expect(writeText).toHaveBeenCalledWith("raven crystal flame");
  });

  it("shows requester bot name and channel context", () => {
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    expect(screen.getByText(/from daily bot/i)).toBeInTheDocument();
    expect(screen.getByText(/in c1/i)).toBeInTheDocument();
  });

  it("shows reason text", () => {
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    expect(screen.getByText("post the daily summary")).toBeInTheDocument();
  });

  it("does not show channel context when contextChannelId is absent", () => {
    const req = { ...baseRequest, contextChannelId: undefined };
    render(<PermissionRequestCard request={req} onDecide={() => {}} />);
    expect(screen.queryByText(/in c1/i)).not.toBeInTheDocument();
  });

  it("collapses remember form when back button is clicked", () => {
    render(<PermissionRequestCard request={baseRequest} onDecide={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /remember/i }));
    expect(screen.getByLabelText(/apply to/i)).toBeInTheDocument();
    // Click the back (←) button
    fireEvent.click(screen.getByRole("button", { name: /←/i }));
    expect(screen.queryByLabelText(/apply to/i)).not.toBeInTheDocument();
    // The three action buttons are back
    expect(
      screen.getByRole("button", { name: /allow once/i }),
    ).toBeInTheDocument();
  });
});
