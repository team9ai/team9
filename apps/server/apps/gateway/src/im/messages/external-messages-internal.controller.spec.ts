import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { WS_EVENTS } from '../websocket/events/events.constants.js';

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

const { ExternalMessagesInternalController } =
  await import('./external-messages-internal.controller.js');

function createDbMock() {
  const limit = jest.fn<any>();
  const whereResult = { limit };
  const query = {
    innerJoin: jest.fn<any>(),
    where: jest.fn<any>().mockReturnValue(whereResult),
  };
  query.innerJoin.mockReturnValue(query);

  const from = jest.fn<any>().mockReturnValue(query);
  const select = jest.fn<any>().mockReturnValue({ from });

  return {
    select,
    chains: { from, query, limit },
  };
}

function makeDto() {
  return {
    message: {
      provider: 'weixin-ilink' as const,
      idempotencyKey: 'weixin-ilink:conn-1:conv-1:msg-1',
      externalTenantId: 'wx-user-1',
      externalConversationId: 'conv-1',
      externalMessageId: 'msg-1',
      sender: { externalUserId: 'wx-peer-1' },
      content: 'hello team9',
      attachments: [] as Array<{
        externalFileId?: string;
        fileName: string;
        mimeType?: string;
        fileSize?: number;
        url?: string;
        raw?: Record<string, unknown>;
      }>,
      occurredAt: '2026-05-25T00:00:00.000Z',
      raw: null,
    },
    binding: {
      connectionId: 'conn-1',
      team9UserId: 'team9-user-1',
      team9TenantId: 'tenant-1',
    },
  };
}

describe('ExternalMessagesInternalController', () => {
  let db: ReturnType<typeof createDbMock>;
  let channelsService: {
    findById: jest.Mock<any>;
    createDirectChannel: jest.Mock<any>;
    isMember: jest.Mock<any>;
  };
  let messagesService: {
    getExternalMessageByClientMsgId: jest.Mock<any>;
    sendFromExternalUser: jest.Mock<any>;
  };
  let websocketGateway: {
    sendToChannelMembers: jest.Mock<any>;
  };
  let controller: InstanceType<typeof ExternalMessagesInternalController>;

  beforeEach(() => {
    db = createDbMock();
    channelsService = {
      findById: jest.fn<any>(),
      createDirectChannel: jest.fn<any>().mockResolvedValue({
        id: 'dm-channel-1',
        tenantId: 'tenant-1',
        isArchived: false,
        isActivated: true,
      }),
      isMember: jest.fn<any>().mockResolvedValue(true),
    };
    messagesService = {
      getExternalMessageByClientMsgId: jest.fn<any>().mockResolvedValue(null),
      sendFromExternalUser: jest.fn<any>().mockResolvedValue({
        channelId: 'dm-channel-1',
        messageId: 'team9-message-1',
        preview: { id: 'team9-message-1' },
      }),
    };
    websocketGateway = {
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
    };
    controller = new ExternalMessagesInternalController(
      db as never,
      channelsService as never,
      messagesService as never,
      websocketGateway as never,
    );
  });

  it('returns duplicate without creating or broadcasting a new message', async () => {
    messagesService.getExternalMessageByClientMsgId.mockResolvedValueOnce({
      id: 'existing-message-1',
      channelId: 'existing-channel-1',
    });
    channelsService.findById.mockResolvedValueOnce({
      id: 'existing-channel-1',
      tenantId: 'tenant-1',
    });

    await expect(controller.ingestExternalMessage(makeDto())).resolves.toEqual({
      team9MessageId: 'existing-message-1',
      team9ChannelId: 'existing-channel-1',
      team9TenantId: 'tenant-1',
      status: 'duplicate',
    });

    expect(messagesService.sendFromExternalUser).not.toHaveBeenCalled();
    expect(websocketGateway.sendToChannelMembers).not.toHaveBeenCalled();
  });

  it('persists a Weixin message as the bound Team9 user and annotates external metadata', async () => {
    db.chains.limit
      .mockResolvedValueOnce([
        { id: 'team9-user-1', userType: 'human', isActive: true },
      ])
      .mockResolvedValueOnce([{ userId: 'team9-user-1' }])
      .mockResolvedValueOnce([{ botUserId: 'assistant-bot-1' }])
      .mockResolvedValueOnce([{ userId: 'assistant-bot-1' }]);

    const result = await controller.ingestExternalMessage(makeDto());

    expect(result).toEqual({
      team9MessageId: 'team9-message-1',
      team9ChannelId: 'dm-channel-1',
      team9TenantId: 'tenant-1',
      status: 'persisted',
    });
    expect(messagesService.sendFromExternalUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'team9-user-1',
        channelId: 'dm-channel-1',
        content: 'hello team9',
        workspaceId: 'tenant-1',
        clientMsgId: expect.stringMatching(/^ext_[0-9a-f]{60}$/),
        metadata: {
          externalIm: expect.objectContaining({
            provider: 'weixin-ilink',
            connectionId: 'conn-1',
            team9UserId: 'team9-user-1',
            team9TenantId: 'tenant-1',
            team9ChannelId: 'dm-channel-1',
            landingBotUserId: 'assistant-bot-1',
            externalMessageId: 'msg-1',
          }),
        },
      }),
    );
    expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
      'dm-channel-1',
      WS_EVENTS.MESSAGE.NEW,
      { id: 'team9-message-1' },
    );
  });

  it('rejects external attachments without a retrievable URL', async () => {
    const dto = makeDto();
    dto.message.attachments = [
      {
        externalFileId: 'wx-file-1',
        fileName: 'image.png',
        mimeType: 'image/png',
        fileSize: 123,
      },
    ];

    await expect(controller.ingestExternalMessage(dto)).rejects.toThrow(
      'External IM attachments without url are not supported yet',
    );

    expect(messagesService.sendFromExternalUser).not.toHaveBeenCalled();
    expect(websocketGateway.sendToChannelMembers).not.toHaveBeenCalled();
  });
});
