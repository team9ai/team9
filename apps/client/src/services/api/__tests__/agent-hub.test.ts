import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendedStaffTemplate } from "../agent-hub";

const mockHttp = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../../http", () => ({
  default: mockHttp,
}));

import agentHubApi from "../agent-hub";

const template: RecommendedStaffTemplate = {
  templateId: "sales-analyst",
  name: "Sales Analyst",
  description: "Analyzes pipeline health",
  displayName: "Sales Analyst",
  roleTitle: "Sales Operations Analyst",
  shortRoleTitle: "Sales Ops",
  persona: null,
  jobDescription: null,
  avatarUrl: null,
  model: { provider: "openrouter", id: "anthropic/claude-sonnet-4.6" },
  unique: true,
  installed: false,
};

describe("agentHubApi", () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
  });

  it("gets recommended staff templates", async () => {
    mockHttp.get.mockResolvedValueOnce({ data: [template] });

    const result = await agentHubApi.getRecommendedStaff();

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff",
    );
    expect(result).toEqual([template]);
  });

  it("installs a recommended staff template with a body", async () => {
    const response = {
      botId: "bot-1",
      userId: "bot-user-1",
      agentId: "common-staff-bot-1",
      displayName: "Sales Analyst",
    };
    mockHttp.post.mockResolvedValueOnce({ data: response });

    const result = await agentHubApi.installRecommendedStaff("sales-analyst", {
      mentorId: "mentor-1",
    });

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff/sales-analyst/install",
      { mentorId: "mentor-1" },
    );
    expect(result).toEqual(response);
  });

  it("defaults install body to an empty object", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: {
        botId: "bot-1",
        userId: "bot-user-1",
        agentId: "common-staff-bot-1",
        displayName: "Sales Analyst",
      },
    });

    await agentHubApi.installRecommendedStaff("sales-analyst");

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff/sales-analyst/install",
      {},
    );
  });

  it("URL-encodes template ids during install", async () => {
    mockHttp.post.mockResolvedValueOnce({
      data: {
        botId: "bot-1",
        userId: "bot-user-1",
        agentId: "common-staff-bot-1",
        displayName: "Sales Analyst",
      },
    });

    await agentHubApi.installRecommendedStaff("sales analyst/华东", {});

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/v1/agent-hub/recommended-staff/sales%20analyst%2F%E5%8D%8E%E4%B8%9C/install",
      {},
    );
  });
});
