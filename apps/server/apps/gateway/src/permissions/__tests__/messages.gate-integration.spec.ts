// apps/server/apps/gateway/src/permissions/__tests__/messages.gate-integration.spec.ts
//
// Integration test that exercises the permission gate in MessagesController.
// Uses the same direct-instantiation pattern as messages.controller.spec.ts to
// avoid the WebsocketGateway circular-dep crash that occurs when Nest resolves
// emitDecoratorMetadata on module load.

import { jest } from '@jest/globals';
import { ForbiddenException, HttpException } from '@nestjs/common';

// Block the circular-dep crash before any dynamic imports
jest.unstable_mockModule('../../im/websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

const { MessagesController } =
  await import('../../im/messages/messages.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOT_ID = 'bot-id-1';
const BOT_USER_ID = 'u-bot';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const TENANT_ID = 't1';
const MESSAGE_ID = 'm1';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    tenantId: TENANT_ID,
    isActivated: true,
    isArchived: false,
    type: 'public',
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    senderId: BOT_USER_ID,
    content: 'hello',
    type: 'text',
    isPinned: false,
    parentId: null,
    createdAt: new Date(),
    sender: {
      id: BOT_USER_ID,
      username: 'bot',
      displayName: 'Bot',
      userType: 'bot',
      agentType: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MessagesController — bot permission gate', () => {
  let controller: InstanceType<typeof MessagesController>;

  // Shared mock objects
  let channelsService: {
    isMember: MockFn;
    findById: MockFn;
    assertMentionsAllowed: MockFn;
  };
  let messagesService: {
    getMessageWithDetails: MockFn;
    mergeProperties: MockFn;
    truncateForPreview: MockFn;
  };
  let imWorkerGrpc: {
    createMessage: MockFn;
  };
  let permissions: {
    gate: MockFn;
    createRequest: MockFn;
  };
  let bots: {
    getBotByUserId: MockFn;
  };
  let websocketGateway: { sendToChannelMembers: MockFn };
  let messagePropertiesService: { batchSet: MockFn };
  let aiAutoFillService: { autoFill: MockFn };
  let eventEmitter: { emit: MockFn };

  beforeEach(() => {
    jest.clearAllMocks();

    channelsService = {
      isMember: jest.fn<any>().mockResolvedValue(true),
      findById: jest.fn<any>().mockResolvedValue(makeChannel()),
      assertMentionsAllowed: jest.fn<any>().mockResolvedValue(undefined),
    };

    messagesService = {
      getMessageWithDetails: jest.fn<any>().mockResolvedValue(makeMessage()),
      mergeProperties: jest
        .fn<any>()
        .mockImplementation((msgs: unknown[]) => Promise.resolve(msgs)),
      truncateForPreview: jest
        .fn<any>()
        .mockImplementation((msg: unknown) => msg),
    };

    imWorkerGrpc = {
      createMessage: jest.fn<any>().mockResolvedValue({ msgId: MESSAGE_ID }),
    };

    permissions = {
      gate: jest.fn<any>().mockResolvedValue({ allowed: false }),
      createRequest: jest.fn<any>().mockResolvedValue({
        id: 'req-123',
        spellId: 'alpha bravo charlie',
      }),
    };

    bots = {
      getBotByUserId: jest.fn<any>().mockResolvedValue(null),
    };

    websocketGateway = {
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(undefined),
    };

    messagePropertiesService = {
      batchSet: jest.fn<any>().mockResolvedValue(undefined),
    };

    aiAutoFillService = {
      autoFill: jest.fn<any>().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emit: jest.fn<any>().mockReturnValue(true),
    };

    controller = new MessagesController(
      messagesService as never,
      channelsService as never,
      websocketGateway as never,
      imWorkerGrpc as never,
      messagePropertiesService as never,
      aiAutoFillService as never,
      {} as never, // propertyDefinitionsService
      eventEmitter as never,
      undefined, // gatewayMQService (optional)
      permissions as never,
      bots as never,
    );
    (controller as any).logger = { debug: jest.fn(), warn: jest.fn() };
  });

  // -------------------------------------------------------------------------
  // Case 1: Non-bot non-member → plain ForbiddenException (no PERMISSION_REQUIRED)
  // -------------------------------------------------------------------------

  it('rejects non-bot non-member with plain ForbiddenException (no PERMISSION_REQUIRED)', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);
    bots.getBotByUserId.mockResolvedValueOnce(null); // not a bot

    await expect(
      controller.createMessage(
        BOT_USER_ID,
        CHANNEL_ID,
        { content: 'hello' } as never,
        TENANT_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissions.gate).not.toHaveBeenCalled();
    expect(permissions.createRequest).not.toHaveBeenCalled();
    expect(imWorkerGrpc.createMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 2: Bot non-member, gate denies → HttpException with PERMISSION_REQUIRED body
  // -------------------------------------------------------------------------

  it('returns 403 PERMISSION_REQUIRED with requestId + spellId when gate denies bot', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);
    bots.getBotByUserId.mockResolvedValueOnce({
      botId: BOT_ID,
      userId: BOT_USER_ID,
    });
    permissions.gate.mockResolvedValueOnce({ allowed: false });
    permissions.createRequest.mockResolvedValueOnce({
      id: 'req-123',
      spellId: 'alpha bravo charlie',
    });

    let thrown: HttpException | null = null;
    try {
      await controller.createMessage(
        BOT_USER_ID,
        CHANNEL_ID,
        { content: 'hello from bot' } as never,
        TENANT_ID,
      );
    } catch (err) {
      thrown = err as HttpException;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(403);

    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 403,
      error: 'PERMISSION_REQUIRED',
      requestId: 'req-123',
      spellId: 'alpha bravo charlie',
      message: expect.any(String),
    });

    expect(permissions.gate).toHaveBeenCalledWith({
      key: 'messages:send',
      metadata: { channelId: CHANNEL_ID },
      ctx: { tenantId: TENANT_ID, botId: BOT_ID, channelId: CHANNEL_ID },
    });

    expect(permissions.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        requesterBotId: BOT_ID,
        permissionKey: 'messages:send',
        requestedMetadata: { channelId: CHANNEL_ID },
        contextChannelId: CHANNEL_ID,
      }),
    );

    expect(imWorkerGrpc.createMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 3: Bot non-member, gate allows → message created (201 fall-through)
  // -------------------------------------------------------------------------

  it('proceeds to create message when gate allows bot', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);
    bots.getBotByUserId.mockResolvedValueOnce({
      botId: BOT_ID,
      userId: BOT_USER_ID,
    });
    permissions.gate.mockResolvedValueOnce({
      allowed: true,
      via: 'grant',
      grantId: 'g1',
    });

    await expect(
      controller.createMessage(
        BOT_USER_ID,
        CHANNEL_ID,
        { content: 'hello from allowed bot' } as never,
        TENANT_ID,
      ),
    ).resolves.toBeDefined();

    expect(imWorkerGrpc.createMessage).toHaveBeenCalled();
    expect(permissions.createRequest).not.toHaveBeenCalled();
    expect(permissions.gate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'messages:send',
        metadata: { channelId: CHANNEL_ID },
        ctx: expect.objectContaining({
          botId: BOT_ID,
          channelId: CHANNEL_ID,
          tenantId: TENANT_ID,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Case C1: Bot targets a channel from a different tenant → plain ForbiddenException
  // -------------------------------------------------------------------------

  it('returns plain ForbiddenException (not PERMISSION_REQUIRED) when bot targets a foreign-tenant channel (C1)', async () => {
    // isMember is false (bot not in this channel)
    channelsService.isMember.mockResolvedValueOnce(false);
    // findById returns a channel belonging to a DIFFERENT tenant
    channelsService.findById.mockResolvedValueOnce(
      makeChannel({ tenantId: 'other-tenant' }),
    );

    await expect(
      controller.createMessage(
        BOT_USER_ID,
        CHANNEL_ID,
        { content: 'cross-tenant attack' } as never,
        TENANT_ID, // caller's tenant is 't1' but channel belongs to 'other-tenant'
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Gate and permission request must NOT be consulted
    expect(permissions.gate).not.toHaveBeenCalled();
    expect(permissions.createRequest).not.toHaveBeenCalled();
    // getBotByUserId must NOT be called either (check happens before bot lookup)
    expect(bots.getBotByUserId).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 4: Bot with no tenantId → plain ForbiddenException (no PERMISSION_REQUIRED)
  // -------------------------------------------------------------------------

  it('falls back to plain ForbiddenException when bot has no tenantId', async () => {
    channelsService.isMember.mockResolvedValueOnce(false);
    bots.getBotByUserId.mockResolvedValueOnce({
      botId: BOT_ID,
      userId: BOT_USER_ID,
    });

    // Pass undefined tenantId — controller guards this as "no tenant, deny"
    await expect(
      controller.createMessage(
        BOT_USER_ID,
        CHANNEL_ID,
        { content: 'hello from bot' } as never,
        undefined, // no tenantId
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Gate must NOT be consulted when tenantId is missing
    expect(permissions.gate).not.toHaveBeenCalled();
    expect(permissions.createRequest).not.toHaveBeenCalled();
  });
});
