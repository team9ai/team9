import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RABBITMQ_ROUTING_KEYS } from '@team9/rabbitmq';
import { WS_EVENTS } from '../websocket/events/events.constants.js';

jest.unstable_mockModule('../websocket/websocket.gateway.js', () => ({
  WebsocketGateway: class WebsocketGateway {},
}));

const { MessagesController } = await import('./messages.controller.js');

type MockFn = jest.Mock<(...args: any[]) => any>;

const USER_ID = 'user-1';
const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const MESSAGE_ID = '550e8400-e29b-41d4-a716-446655440001';
const WORKSPACE_ID = 'workspace-1';
const CLIENT_MSG_ID = 'client-msg-1';
const NOW = 1_700_000_000_000;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    senderId: USER_ID,
    content: 'hello',
    type: 'text',
    isPinned: false,
    parentId: null,
    createdAt: new Date(NOW),
    sender: {
      id: USER_ID,
      username: 'alice',
      displayName: 'Alice',
      userType: 'human',
      agentType: null,
    },
    ...overrides,
  };
}

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    tenantId: WORKSPACE_ID,
    isActivated: true,
    isArchived: false,
    ...overrides,
  };
}

describe('MessagesController', () => {
  let controller: MessagesController;
  let messagesService: {
    getChannelMessages: MockFn;
    getChannelMessagesPaginated: MockFn;
    markAsRead: MockFn;
    getMessageWithDetails: MockFn;
    update: MockFn;
    getMessageChannelId: MockFn;
    delete: MockFn;
    getThread: MockFn;
    getSubReplies: MockFn;
    pinMessage: MockFn;
    addReaction: MockFn;
    removeReaction: MockFn;
    truncateForPreview: MockFn;
    getFullContent: MockFn;
    mergeProperties: MockFn;
  };
  let channelsService: {
    assertReadAccess: MockFn;
    assertWriteAccess: MockFn;
    isMember: MockFn;
    findById: MockFn;
    findByIdOrThrow: MockFn;
    getMemberRole: MockFn;
    assertMentionsAllowed: MockFn;
  };
  let websocketGateway: {
    sendToChannelMembers: MockFn;
  };
  let imWorkerGrpcClientService: {
    createMessage: MockFn;
  };
  let messagePropertiesService: {
    batchSet: MockFn;
  };
  let aiAutoFillService: {
    autoFill: MockFn;
  };
  let propertyDefinitionsService: Record<string, never>;
  let eventEmitter: {
    emit: MockFn;
  };
  let gatewayMQService:
    | {
        isReady: MockFn;
        publishPostBroadcast: MockFn;
        publishWorkspaceEvent: MockFn;
      }
    | undefined;
  let dateSpy: jest.Spied<typeof Date.now>;

  beforeEach(() => {
    messagesService = {
      getChannelMessages: jest.fn<any>().mockResolvedValue([makeMessage()]),
      getChannelMessagesPaginated: jest.fn<any>().mockResolvedValue({
        messages: [makeMessage()],
        hasOlder: false,
        hasNewer: false,
      }),
      markAsRead: jest.fn<any>().mockResolvedValue(undefined),
      getMessageWithDetails: jest.fn<any>().mockResolvedValue(makeMessage()),
      update: jest.fn<any>().mockResolvedValue(makeMessage()),
      getMessageChannelId: jest.fn<any>().mockResolvedValue(CHANNEL_ID),
      delete: jest.fn<any>().mockResolvedValue(undefined),
      getThread: jest.fn<any>().mockResolvedValue({
        rootMessage: makeMessage(),
        replies: [],
        totalReplyCount: 0,
        hasMore: false,
        nextCursor: null,
      }),
      getSubReplies: jest.fn<any>().mockResolvedValue({
        replies: [],
        hasMore: false,
        nextCursor: null,
      }),
      pinMessage: jest.fn<any>().mockResolvedValue(undefined),
      addReaction: jest.fn<any>().mockResolvedValue(undefined),
      removeReaction: jest.fn<any>().mockResolvedValue(undefined),
      truncateForPreview: jest.fn<any>().mockImplementation((msg) => msg),
      getFullContent: jest
        .fn<any>()
        .mockResolvedValue({ content: 'full content' }),
      mergeProperties: jest
        .fn<any>()
        .mockImplementation((msgs) => Promise.resolve(msgs)),
    };

    channelsService = {
      assertReadAccess: jest.fn<any>().mockResolvedValue(undefined),
      assertWriteAccess: jest.fn<any>().mockResolvedValue(undefined),
      isMember: jest.fn<any>().mockResolvedValue(true),
      findById: jest.fn<any>().mockResolvedValue(makeChannel()),
      findByIdOrThrow: jest.fn<any>().mockResolvedValue({
        ...makeChannel({ type: 'direct' }),
        unreadCount: 0,
        lastReadMessageId: null,
        otherUser: {
          id: 'bot-user-1',
          username: 'alpha_agent',
          displayName: 'Alpha Agent',
          avatarUrl: null,
          status: 'online',
          userType: 'bot',
          agentType: 'openclaw',
        },
      }),
      getMemberRole: jest.fn<any>().mockResolvedValue('owner'),
      assertMentionsAllowed: jest.fn<any>().mockResolvedValue(undefined),
    };

    websocketGateway = {
      sendToChannelMembers: jest.fn<any>().mockResolvedValue(true),
    };

    imWorkerGrpcClientService = {
      createMessage: jest.fn<any>().mockResolvedValue({ msgId: MESSAGE_ID }),
    };

    eventEmitter = {
      emit: jest.fn<any>(),
    };

    gatewayMQService = {
      isReady: jest.fn<any>().mockReturnValue(true),
      publishPostBroadcast: jest.fn<any>().mockResolvedValue(undefined),
      publishWorkspaceEvent: jest.fn<any>().mockResolvedValue(undefined),
    };

    messagePropertiesService = {
      batchSet: jest.fn<any>().mockResolvedValue(undefined),
    };

    aiAutoFillService = {
      autoFill: jest.fn<any>().mockResolvedValue(undefined),
    };

    propertyDefinitionsService = {};

    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);

    controller = new MessagesController(
      messagesService as never,
      channelsService as never,
      websocketGateway as never,
      imWorkerGrpcClientService as never,
      messagePropertiesService as never,
      aiAutoFillService as never,
      propertyDefinitionsService as never,
      eventEmitter as never,
      gatewayMQService as never,
    );
    (controller as any).logger = {
      debug: jest.fn(),
      warn: jest.fn(),
    };
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  describe('getChannelMessages', () => {
    it('uses legacy flat messages for the default path', async () => {
      await expect(
        controller.getChannelMessages(
          USER_ID,
          CHANNEL_ID,
          undefined,
          'cursor-1',
        ),
      ).resolves.toEqual([makeMessage()]);

      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.getChannelMessages).toHaveBeenCalledWith(
        CHANNEL_ID,
        50,
        'cursor-1',
      );
      expect(
        messagesService.getChannelMessagesPaginated,
      ).not.toHaveBeenCalled();
    });

    it('uses the paginated path when after is present', async () => {
      await expect(
        controller.getChannelMessages(
          USER_ID,
          CHANNEL_ID,
          '25',
          undefined,
          'after-cursor',
          undefined,
        ),
      ).resolves.toEqual({
        messages: [makeMessage()],
        hasOlder: false,
        hasNewer: false,
      });

      expect(messagesService.getChannelMessagesPaginated).toHaveBeenCalledWith(
        CHANNEL_ID,
        25,
        { before: undefined, after: 'after-cursor', around: undefined },
      );
      expect(messagesService.getChannelMessages).not.toHaveBeenCalled();
    });
  });

  describe('createMessage', () => {
    it('rejects non-members (delegates to assertWriteAccess)', async () => {
      channelsService.assertWriteAccess.mockRejectedValueOnce(
        new ForbiddenException('Access denied'),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(channelsService.assertWriteAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
      expect(websocketGateway.sendToChannelMembers).not.toHaveBeenCalled();
    });

    it('rejects deactivated channels (delegates to assertWriteAccess)', async () => {
      channelsService.assertWriteAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'Channel is deactivated — execution has completed',
        ),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(channelsService.assertWriteAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('rejects archived channels (delegates to assertWriteAccess)', async () => {
      channelsService.assertWriteAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'Channel is archived and no longer accepts new messages',
        ),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(channelsService.assertWriteAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('archived-channel error message mentions "archived"', async () => {
      channelsService.assertWriteAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'Channel is archived and no longer accepts new messages',
        ),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).rejects.toThrow(/archived/i);
    });

    it('deactivated-channel error message mentions "deactivated"', async () => {
      // The deactivation check wins over archive — this is now enforced by
      // assertWriteAccess in ChannelsService (tested there). The controller
      // test verifies it surfaces the right message when the service throws.
      channelsService.assertWriteAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'Channel is deactivated — execution has completed',
        ),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).rejects.toThrow(/deactivated/i);

      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('broadcasts, publishes MQ work, and emits search events on success', async () => {
      const dto = {
        clientMsgId: CLIENT_MSG_ID,
        content: 'hello',
        attachments: [
          {
            fileKey: 'file-key-1',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            fileSize: 1234,
          },
        ],
        metadata: { source: 'unit-test' },
      } as never;
      const fullMessage = makeMessage({
        type: 'file',
        content: 'report.pdf',
      });
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, dto),
      ).resolves.toEqual(fullMessage);

      expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith({
        clientMsgId: CLIENT_MSG_ID,
        channelId: CHANNEL_ID,
        senderId: USER_ID,
        content: 'hello',
        parentId: undefined,
        type: 'file',
        workspaceId: WORKSPACE_ID,
        attachments: dto.attachments,
        metadata: dto.metadata,
      });
      expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.MESSAGE.NEW,
        fullMessage,
      );
      expect(gatewayMQService?.publishPostBroadcast).toHaveBeenCalledWith({
        msgId: MESSAGE_ID,
        channelId: CHANNEL_ID,
        senderId: USER_ID,
        workspaceId: WORKSPACE_ID,
        broadcastAt: NOW,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('message.created', {
        message: {
          id: fullMessage.id,
          channelId: fullMessage.channelId,
          senderId: fullMessage.senderId,
          content: fullMessage.content,
          type: fullMessage.type,
          isPinned: fullMessage.isPinned,
          parentId: fullMessage.parentId,
          createdAt: fullMessage.createdAt,
        },
        channel: makeChannel(),
        sender: {
          id: USER_ID,
          username: 'alice',
          displayName: 'Alice',
        },
      });
      expect(gatewayMQService?.publishWorkspaceEvent).toHaveBeenCalledWith(
        RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED,
        {
          channelId: fullMessage.channelId,
          messageId: fullMessage.id,
          content: fullMessage.content,
          messageType: fullMessage.type,
          senderId: fullMessage.senderId,
          senderUserType: 'human',
          senderAgentType: null,
        },
      );
    });

    it('does not publish channel triggers for bot-authored messages', async () => {
      const fullMessage = makeMessage({
        senderId: 'bot-user-1',
        sender: {
          id: 'bot-user-1',
          username: 'helper',
          displayName: 'Helper',
          userType: 'bot',
          agentType: 'openclaw',
        },
      });
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
        } as never),
      ).resolves.toEqual(fullMessage);

      expect(gatewayMQService?.publishWorkspaceEvent).not.toHaveBeenCalled();
      expect(gatewayMQService?.publishPostBroadcast).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'message.created',
        expect.objectContaining({
          message: expect.objectContaining({
            id: fullMessage.id,
            senderId: fullMessage.senderId,
          }),
        }),
      );
    });

    it('skips websocket broadcast and MQ publish when skipBroadcast is set and MQ is not ready', async () => {
      gatewayMQService?.isReady.mockReturnValueOnce(false);

      const fullMessage = makeMessage();
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hello',
          skipBroadcast: true,
        } as never),
      ).resolves.toEqual(fullMessage);

      expect(websocketGateway.sendToChannelMembers).not.toHaveBeenCalled();
      expect(gatewayMQService?.publishPostBroadcast).not.toHaveBeenCalled();
      expect((controller as any).logger.warn).toHaveBeenCalledWith(
        `[sendMessage] GatewayMQService not ready, skipping post-broadcast task`,
      );
      expect(gatewayMQService?.publishWorkspaceEvent).toHaveBeenCalledWith(
        RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED,
        expect.objectContaining({
          messageId: fullMessage.id,
        }),
      );
    });

    it('calls assertMentionsAllowed when message contains @mentions', async () => {
      const mentionedUserId = '550e8400-e29b-41d4-a716-446655440099';
      const fullMessage = makeMessage({
        content: `Hello @<${mentionedUserId}>`,
      });
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await controller.createMessage(USER_ID, CHANNEL_ID, {
        clientMsgId: CLIENT_MSG_ID,
        content: `Hello @<${mentionedUserId}>`,
      } as never);

      expect(channelsService.assertMentionsAllowed).toHaveBeenCalledWith(
        USER_ID,
        [mentionedUserId],
      );
    });

    it('rejects message when mentioning a restricted personal staff bot', async () => {
      const mentionedUserId = '550e8400-e29b-41d4-a716-446655440099';
      channelsService.assertMentionsAllowed.mockRejectedValueOnce(
        new BadRequestException(
          'This is a private assistant and is not open for @mentions.',
        ),
      );

      await expect(
        controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: `Hello @<${mentionedUserId}>`,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
    });

    it('does not call assertMentionsAllowed when message has no @mentions', async () => {
      const fullMessage = makeMessage();
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await controller.createMessage(USER_ID, CHANNEL_ID, {
        clientMsgId: CLIENT_MSG_ID,
        content: 'hello world',
      } as never);

      expect(channelsService.assertMentionsAllowed).not.toHaveBeenCalled();
    });

    describe('clientContext top-level field', () => {
      it('merges macapp clientContext into metadata.clientContext', async () => {
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          makeMessage(),
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hi',
          clientContext: { kind: 'macapp', deviceId: 'dev-abc' },
        } as never);

        expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              clientContext: { kind: 'macapp', deviceId: 'dev-abc' },
            },
          }),
        );
      });

      it('merges web clientContext into metadata.clientContext', async () => {
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          makeMessage(),
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hi',
          clientContext: { kind: 'web' },
        } as never);

        expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { clientContext: { kind: 'web' } },
          }),
        );
      });

      it('preserves existing metadata fields when merging clientContext', async () => {
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          makeMessage(),
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hi',
          metadata: { source: 'api', trackingId: 't1' },
          clientContext: { kind: 'macapp', deviceId: null },
        } as never);

        expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              source: 'api',
              trackingId: 't1',
              clientContext: { kind: 'macapp', deviceId: null },
            },
          }),
        );
      });

      it('leaves metadata untouched when clientContext is absent', async () => {
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          makeMessage(),
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'hi',
          metadata: { source: 'api' },
        } as never);

        expect(imWorkerGrpcClientService.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({ metadata: { source: 'api' } }),
        );
      });
    });

    describe('contentAst ingress', () => {
      // When the client posts a Lexical AST alongside content, the controller
      // must: (a) validate structure, (b) re-derive plaintext `content` from
      // the AST (to keep search/preview/fallback in sync), (c) forward BOTH
      // to the gRPC layer. This is the ingest-side guarantee that underpins
      // the XSS-safe render path on the client.

      const validAst = {
        root: {
          type: 'root',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: [
            {
              type: 'paragraph',
              version: 1,
              direction: null,
              format: '',
              indent: 0,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'hello from AST',
                  format: 0,
                  detail: 0,
                  mode: 'normal',
                  style: '',
                },
              ],
            },
          ],
        },
      };

      it('forwards both normalized content and contentAst to gRPC', async () => {
        const fullMessage = makeMessage();
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          fullMessage,
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          // Client may send a stale / incorrect content string — server must
          // override it with whatever astToPlaintext produces.
          content: 'stale from optimistic update',
          contentAst: validAst,
        } as never);

        const call = imWorkerGrpcClientService.createMessage.mock.calls[0][0];
        expect(call.content).toBe('hello from AST');
        expect(call.contentAst).toBeDefined();
        expect(call.contentAst.root.children).toHaveLength(1);
      });

      it('rejects contentAst whose root.children is not an array', async () => {
        await expect(
          controller.createMessage(USER_ID, CHANNEL_ID, {
            clientMsgId: CLIENT_MSG_ID,
            content: 'anything',
            contentAst: { root: { type: 'root', children: 'nope' } },
          } as never),
        ).rejects.toThrow();
        expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
      });

      it('rejects a pathologically deep contentAst', async () => {
        let node: Record<string, unknown> = { type: 'text', text: 'leaf' };
        for (let i = 0; i < 60; i++) {
          node = { type: 'paragraph', children: [node] };
        }
        const deep = {
          root: { type: 'root', version: 1, children: [node] },
        };

        await expect(
          controller.createMessage(USER_ID, CHANNEL_ID, {
            clientMsgId: CLIENT_MSG_ID,
            content: 'x',
            contentAst: deep,
          } as never),
        ).rejects.toThrow(/depth/);
        expect(imWorkerGrpcClientService.createMessage).not.toHaveBeenCalled();
      });

      it('passes through unchanged when contentAst is absent (legacy/bot path)', async () => {
        const fullMessage = makeMessage();
        messagesService.getMessageWithDetails.mockResolvedValueOnce(
          fullMessage,
        );

        await controller.createMessage(USER_ID, CHANNEL_ID, {
          clientMsgId: CLIENT_MSG_ID,
          content: 'pure text',
        } as never);

        const call = imWorkerGrpcClientService.createMessage.mock.calls[0][0];
        expect(call.content).toBe('pure text');
        expect(call.contentAst).toBeUndefined();
      });
    });
  });

  describe('message reads and details', () => {
    it('marks a channel message as read', async () => {
      await expect(
        controller.markAsRead(USER_ID, CHANNEL_ID, { messageId: MESSAGE_ID }),
      ).resolves.toEqual({ success: true });

      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.markAsRead).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
        MESSAGE_ID,
      );
    });

    it('fetches a single message and checks read access', async () => {
      const fullMessage = makeMessage();
      messagesService.getMessageWithDetails.mockResolvedValueOnce(fullMessage);

      await expect(controller.getMessage(USER_ID, MESSAGE_ID)).resolves.toEqual(
        fullMessage,
      );

      expect(messagesService.getMessageWithDetails).toHaveBeenCalledWith(
        MESSAGE_ID,
      );
      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
    });

    it('updates a message, broadcasts it, and emits the update event', async () => {
      const updatedMessage = makeMessage({
        content: 'edited',
      });
      messagesService.update.mockResolvedValueOnce(updatedMessage);
      channelsService.findById.mockResolvedValueOnce(makeChannel());

      await expect(
        controller.updateMessage(USER_ID, MESSAGE_ID, {
          content: 'edited',
        } as never),
      ).resolves.toEqual(updatedMessage);

      expect(messagesService.update).toHaveBeenCalledWith(MESSAGE_ID, USER_ID, {
        content: 'edited',
      });
      expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.MESSAGE.UPDATED,
        updatedMessage,
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('message.updated', {
        message: {
          id: updatedMessage.id,
          channelId: updatedMessage.channelId,
          senderId: updatedMessage.senderId,
          content: updatedMessage.content,
          type: updatedMessage.type,
          isPinned: updatedMessage.isPinned,
          parentId: updatedMessage.parentId,
          createdAt: updatedMessage.createdAt,
        },
        channel: makeChannel(),
        sender: {
          id: USER_ID,
          username: 'alice',
          displayName: 'Alice',
        },
      });
    });

    it('deletes a message, broadcasts deletion, and emits the removal event', async () => {
      messagesService.getMessageChannelId.mockResolvedValueOnce(CHANNEL_ID);

      await expect(
        controller.deleteMessage(USER_ID, MESSAGE_ID),
      ).resolves.toEqual({ success: true });

      expect(channelsService.getMemberRole).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.delete).toHaveBeenCalledWith(
        MESSAGE_ID,
        USER_ID,
        'owner',
      );
      expect(websocketGateway.sendToChannelMembers).toHaveBeenCalledWith(
        CHANNEL_ID,
        WS_EVENTS.MESSAGE.DELETED,
        { messageId: MESSAGE_ID, channelId: CHANNEL_ID },
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'message.deleted',
        MESSAGE_ID,
      );
    });
  });

  describe('threading', () => {
    it('loads a thread with parsed limit and cursor', async () => {
      await expect(
        controller.getThread(USER_ID, MESSAGE_ID, '12', 'cursor-12'),
      ).resolves.toEqual({
        rootMessage: makeMessage(),
        replies: [],
        totalReplyCount: 0,
        hasMore: false,
        nextCursor: null,
      });

      expect(messagesService.getMessageChannelId).toHaveBeenCalledWith(
        MESSAGE_ID,
      );
      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.getThread).toHaveBeenCalledWith(
        MESSAGE_ID,
        12,
        'cursor-12',
      );
    });

    it('loads sub-replies with the default limit', async () => {
      await expect(
        controller.getSubReplies(USER_ID, MESSAGE_ID, undefined, 'cursor-2'),
      ).resolves.toEqual({
        replies: [],
        hasMore: false,
        nextCursor: null,
      });

      expect(messagesService.getSubReplies).toHaveBeenCalledWith(
        MESSAGE_ID,
        20,
        'cursor-2',
      );
    });
  });

  describe('pins and reactions', () => {
    it('allows owners to pin and unpin messages', async () => {
      await expect(controller.pinMessage(USER_ID, MESSAGE_ID)).resolves.toEqual(
        {
          success: true,
        },
      );
      await expect(
        controller.unpinMessage(USER_ID, MESSAGE_ID),
      ).resolves.toEqual({ success: true });

      expect(messagesService.pinMessage).toHaveBeenNthCalledWith(
        1,
        MESSAGE_ID,
        true,
      );
      expect(messagesService.pinMessage).toHaveBeenNthCalledWith(
        2,
        MESSAGE_ID,
        false,
      );
    });

    it('rejects pin and unpin for non-admin members', async () => {
      channelsService.getMemberRole.mockResolvedValueOnce('member');

      await expect(
        controller.pinMessage(USER_ID, MESSAGE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      channelsService.getMemberRole.mockResolvedValueOnce(undefined);

      await expect(
        controller.unpinMessage(USER_ID, MESSAGE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(messagesService.pinMessage).not.toHaveBeenCalled();
    });

    it('adds and removes reactions', async () => {
      await expect(
        controller.addReaction(USER_ID, MESSAGE_ID, { emoji: '👍' } as never),
      ).resolves.toEqual({ success: true });
      await expect(
        controller.removeReaction(USER_ID, MESSAGE_ID, '👍'),
      ).resolves.toEqual({ success: true });

      expect(messagesService.addReaction).toHaveBeenCalledWith(
        MESSAGE_ID,
        USER_ID,
        '👍',
      );
      expect(messagesService.removeReaction).toHaveBeenCalledWith(
        MESSAGE_ID,
        USER_ID,
        '👍',
      );
    });
  });

  describe('getFullContent', () => {
    it('returns full content when user has read access', async () => {
      await expect(
        controller.getFullContent(USER_ID, MESSAGE_ID),
      ).resolves.toEqual({ content: 'full content' });

      expect(messagesService.getMessageChannelId).toHaveBeenCalledWith(
        MESSAGE_ID,
      );
      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.getFullContent).toHaveBeenCalledWith(MESSAGE_ID);
    });

    it('throws ForbiddenException when user lacks read access', async () => {
      channelsService.assertReadAccess.mockRejectedValueOnce(
        new ForbiddenException('Access denied'),
      );

      await expect(
        controller.getFullContent(USER_ID, MESSAGE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(messagesService.getMessageChannelId).toHaveBeenCalledWith(
        MESSAGE_ID,
      );
      expect(channelsService.assertReadAccess).toHaveBeenCalledWith(
        CHANNEL_ID,
        USER_ID,
      );
      expect(messagesService.getFullContent).not.toHaveBeenCalled();
    });

    it('delegates to messagesService.getFullContent with the message id', async () => {
      const customContent = { content: 'very long text'.repeat(100) };
      messagesService.getFullContent.mockResolvedValueOnce(customContent);

      const result = await controller.getFullContent(USER_ID, MESSAGE_ID);

      expect(result).toEqual(customContent);
      expect(messagesService.getFullContent).toHaveBeenCalledTimes(1);
      expect(messagesService.getFullContent).toHaveBeenCalledWith(MESSAGE_ID);
    });
  });
});
