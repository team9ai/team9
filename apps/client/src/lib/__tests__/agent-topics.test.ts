import { describe, expect, it, vi } from "vitest";
import { navigateToNewTopic } from "../agent-topics";

describe("navigateToNewTopic", () => {
  it("navigates to the dashboard composer with the agent pre-selected", () => {
    const navigate = vi.fn();
    navigateToNewTopic(navigate as never, "agent-user-42");
    expect(navigate).toHaveBeenCalledWith({
      to: "/channels",
      search: { agentId: "agent-user-42" },
    });
  });
});
