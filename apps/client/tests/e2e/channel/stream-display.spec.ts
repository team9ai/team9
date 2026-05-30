import { expect, test, type Page, type Route } from "@playwright/test";

import { installMockHub } from "../ahand/fixtures/mock-hub";

const CHANNEL_ID = "channel-stream-e2e";
const CURRENT_USER_ID = "00000000-0000-4000-8000-0000000000aa";
const PEER_USER_ID = "00000000-0000-4000-8000-0000000000cc";
const BOT_USER_ID = "00000000-0000-4000-8000-0000000000dd";
const ACTIVE_STREAM_STARTED_AT = Date.parse("2026-01-01T00:00:06.000Z");

type ChannelMocksOptions = {
  messages?: ReturnType<typeof makeMessage>[];
};

function fulfillJson(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

function makeMessage(
  id: string,
  content: string,
  createdAt: string,
  metadata: Record<string, unknown> | null = null,
  senderId = BOT_USER_ID,
) {
  return {
    id,
    channelId: CHANNEL_ID,
    senderId,
    content,
    contentAst: null,
    type: "text",
    parentId: null,
    metadata,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: null,
    isPinned: false,
    replyCount: 0,
    attachments: [],
    reactions: [],
    mentions: [],
    properties: [],
    sender:
      senderId === CURRENT_USER_ID
        ? {
            id: CURRENT_USER_ID,
            username: "tester",
            displayName: "E2E Tester",
            avatarUrl: null,
            userType: "human",
          }
        : {
            id: BOT_USER_ID,
            username: "streambot",
            displayName: "Stream Bot",
            avatarUrl: null,
            userType: "bot",
          },
  };
}

function makeActiveStreams() {
  return [
    {
      streamId: "stream-e2e",
      channelId: CHANNEL_ID,
      senderId: BOT_USER_ID,
      startedAt: ACTIVE_STREAM_STARTED_AT,
      thinking: "Planning the streamed UI",
      content: "Streaming reply from shared UI",
    },
  ];
}

function makeStandardMessages() {
  return [
    makeMessage(
      "after-old-round",
      "Message after old agent round",
      "2026-01-01T00:00:05.000Z",
      null,
      CURRENT_USER_ID,
    ),
    makeMessage("old-agent-end", "", "2026-01-01T00:00:04.000Z", {
      agentEventType: "agent_end",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:04.000Z",
      durationMs: 4_000,
    }),
    makeMessage("old-tool-call", "tool call", "2026-01-01T00:00:03.000Z", {
      agentEventType: "tool_call",
      status: "completed",
      toolCallId: "tool-old-1",
      toolName: "search",
    }),
    makeMessage("old-thinking", "prior reasoning", "2026-01-01T00:00:02.000Z", {
      agentEventType: "thinking",
      status: "completed",
      thinking: "prior reasoning",
      durationMs: 1_000,
    }),
    makeMessage("old-agent-start", "", "2026-01-01T00:00:01.000Z", {
      agentEventType: "agent_start",
      status: "completed",
      startedAt: "2026-01-01T00:00:01.000Z",
    }),
  ];
}

function makeLongMessages() {
  const base = Date.parse("2026-01-01T00:02:00.000Z");

  return Array.from({ length: 90 }, (_, index) => {
    const historyIndex = 89 - index;
    return makeMessage(
      `history-${historyIndex}`,
      `History message ${historyIndex + 1}`,
      new Date(base + historyIndex * 1000).toISOString(),
      null,
      historyIndex % 3 === 0 ? CURRENT_USER_ID : BOT_USER_ID,
    );
  });
}

async function scrollEveryScrollableToBottom(page: Page) {
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll("[data-virtuoso-scroller]"),
      ...document.querySelectorAll('[style*="overflow"]'),
    ];
    for (const element of candidates) {
      if (element instanceof HTMLElement) {
        element.scrollTop = element.scrollHeight;
      }
    }
  });
}

async function installChannelMocks(
  page: Page,
  options: ChannelMocksOptions = {},
) {
  const channel = {
    id: CHANNEL_ID,
    name: "Stream E2E DM",
    description: null,
    type: "direct",
    workspaceId: "00000000-0000-4000-8000-0000000000bb",
    createdById: CURRENT_USER_ID,
    isArchived: false,
    isMember: true,
    unreadCount: 0,
    lastReadMessageId: null,
    showInDmSidebar: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    otherUser: {
      id: PEER_USER_ID,
      username: "mentor",
      displayName: "Mentor",
      avatarUrl: null,
      userType: "human",
    },
  };

  const members = [
    {
      id: "member-current",
      channelId: CHANNEL_ID,
      userId: CURRENT_USER_ID,
      role: "member",
      joinedAt: "2026-01-01T00:00:00.000Z",
      user: {
        id: CURRENT_USER_ID,
        username: "tester",
        displayName: "E2E Tester",
        avatarUrl: null,
        userType: "human",
      },
    },
    {
      id: "member-bot",
      channelId: CHANNEL_ID,
      userId: BOT_USER_ID,
      role: "member",
      joinedAt: "2026-01-01T00:00:00.000Z",
      user: {
        id: BOT_USER_ID,
        username: "streambot",
        displayName: "Stream Bot",
        avatarUrl: null,
        userType: "bot",
      },
    },
  ];

  const messages = options.messages ?? makeStandardMessages();

  await page.route(`**/api/v1/im/channels/${CHANNEL_ID}`, (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, channel);
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(`**/api/v1/im/channels/${CHANNEL_ID}/members`, (route) =>
    fulfillJson(route, members),
  );
  await page.route(`**/api/v1/im/channels/${CHANNEL_ID}/messages**`, (route) =>
    fulfillJson(route, {
      messages,
      hasOlder: false,
      hasNewer: false,
    }),
  );
  await page.route(
    `**/api/v1/im/channels/${CHANNEL_ID}/streaming/active`,
    (route) => fulfillJson(route, makeActiveStreams()),
  );
  await page.route(`**/api/v1/im/sync/channel/${CHANNEL_ID}**`, (route) =>
    fulfillJson(route, { messages: [], lastSeqId: null }),
  );
  await page.route(`**/api/v1/im/channels/${CHANNEL_ID}/read`, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/v1/im/channels/public", (route) =>
    fulfillJson(route, []),
  );
  await page.route(/\/api\/v1\/workspaces\/[^/]+\/members(\?.*)?$/, (route) =>
    fulfillJson(route, {
      members: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
  );
  await page.route(
    /\/api\/v1\/im\/messages\/[^/]+\/properties\/relations(\?.*)?$/,
    (route) =>
      fulfillJson(route, {
        outgoing: { parent: [], related: [] },
        incoming: { children: [], relatedBy: [] },
      }),
  );
}

async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(() => {
    const jwtHeader = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(
      /=+$/,
      "",
    );
    const jwtPayload = btoa(
      JSON.stringify({
        sub: "00000000-0000-4000-8000-0000000000aa",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).replace(/=+$/, "");
    const fakeJwt = `${jwtHeader}.${jwtPayload}.sig`;
    localStorage.setItem("auth_token", fakeJwt);
    localStorage.setItem("refresh_token", fakeJwt);
    sessionStorage.setItem("app_initialized", "true");
  });
}

test.describe("channel stream display package", () => {
  test("renders streaming, thinking, and folded rounds through the browser UI", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await installMockHub(page, { initialDevices: [] });
    await installChannelMocks(page);

    await page.goto(`/messages/${CHANNEL_ID}`);

    await expect(page).toHaveURL(new RegExp(`/messages/${CHANNEL_ID}`));

    await expect(
      page.getByRole("button", {
        name: /Expand execution process \(3 steps\)/i,
      }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.locator("[data-stream-view]")).toBeVisible();
    await expect(
      page.locator('[data-stream-item-kind="thinking"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-stream-item-kind="agent-message"]'),
    ).toBeVisible();
    await expect(
      page.getByText("Streaming reply from shared UI"),
    ).toBeVisible();
    await expect(page.getByText(/^Thought for/).first()).toBeVisible();

    const foldedRound = page.getByRole("button", {
      name: /Expand execution process \(3 steps\)/i,
    });
    await foldedRound.click();
    await expect(foldedRound).toBeHidden();
    await expect(
      page.getByText("Streaming reply from shared UI"),
    ).toBeVisible();
  });

  test("keeps the active stream visible inside the virtualized message list", async ({
    page,
  }) => {
    await seedAuthenticatedSession(page);
    await installMockHub(page, { initialDevices: [] });
    await installChannelMocks(page, { messages: makeLongMessages() });

    await page.goto(`/messages/${CHANNEL_ID}`);
    await expect(page).toHaveURL(new RegExp(`/messages/${CHANNEL_ID}`));

    await scrollEveryScrollableToBottom(page);

    await expect(page.locator("[data-stream-view]")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Streaming reply from shared UI"),
    ).toBeVisible();

    const renderedItems = await page.locator("[data-item-index]").count();
    expect(renderedItems).toBeGreaterThan(0);
    expect(renderedItems).toBeLessThan(90);
  });
});
