import { describe, expect, it } from "vitest";
import {
  getAgentSidebarSubtitle,
  type SidebarAgentMetadata,
} from "../useAgentGroupsForSidebar";

function makeAgent(
  overrides: Partial<SidebarAgentMetadata>,
): SidebarAgentMetadata {
  return {
    label: "Agent",
    agentType: null,
    applicationId: "common-staff",
    staffKind: "common",
    roleTitle: null,
    shortRoleTitle: null,
    ownerName: null,
    ...overrides,
  };
}

describe("getAgentSidebarSubtitle", () => {
  it("uses the common staff role title", () => {
    expect(
      getAgentSidebarSubtitle(makeAgent({ roleTitle: "Product Manager" })),
    ).toBe("Product Manager");
  });

  it("prefers the generated short role title for common staff", () => {
    expect(
      getAgentSidebarSubtitle(
        makeAgent({
          roleTitle: "Performance Tracking Analyst",
          shortRoleTitle: "Perf",
        }),
      ),
    ).toBe("Perf");
  });

  it("hides the common staff role title when it matches the display name", () => {
    expect(
      getAgentSidebarSubtitle(
        makeAgent({
          label: "Product Manager",
          roleTitle: "Product Manager",
          shortRoleTitle: "PM",
        }),
      ),
    ).toBeNull();
  });

  it("labels OpenClaw agents by provider", () => {
    expect(
      getAgentSidebarSubtitle(
        makeAgent({
          agentType: "openclaw",
          applicationId: "openclaw",
          staffKind: null,
        }),
      ),
    ).toBe("OpenClaw");
  });

  it("uses owner assistant wording for personal staff", () => {
    expect(
      getAgentSidebarSubtitle(
        makeAgent({
          applicationId: "personal-staff",
          staffKind: "personal",
          ownerName: "Winrey",
        }),
      ),
    ).toBe("Winrey助理");
  });

  it("labels base model agents as Model", () => {
    expect(
      getAgentSidebarSubtitle(
        makeAgent({
          agentType: "base_model",
          applicationId: "base-model-staff",
          staffKind: "other",
        }),
      ),
    ).toBe("Model");
  });
});
