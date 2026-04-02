import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { MessageGrpcController } from './message.grpc-controller.js';
import type { CreateMessageDto, CreateMessageResponse } from '@team9/shared';

describe('MessageGrpcController', () => {
  let controller: MessageGrpcController;
  let messageService: {
    createAndPersist: jest.Mock<any>;
  };

  beforeEach(() => {
    messageService = {
      createAndPersist: jest.fn<any>(),
    };

    controller = new MessageGrpcController(messageService as any);
    (controller as any).logger = {
      debug: jest.fn(),
      error: jest.fn(),
    };
  });

  function makeRequest(
    overrides: Partial<{
      client_msg_id: string;
      channel_id: string;
      sender_id: string;
      content: string;
      parent_id?: string;
      type: 'text' | 'file' | 'image';
      attachments?: Array<{
        file_key: string;
        file_name: string;
        file_size: string;
        mime_type: string;
      }>;
      metadata_json?: string;
      workspace_id?: string;
    }> = {},
  ) {
    return {
      client_msg_id: 'client-msg-1',
      channel_id: 'channel-1',
      sender_id: 'user-1',
      content: 'hello',
      type: 'text' as const,
      ...overrides,
    };
  }

  async function expectInvalidArgument(
    request: Parameters<MessageGrpcController['createMessage']>[0],
    message: string,
  ) {
    try {
      await controller.createMessage(request);
      throw new Error('Expected createMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message,
      });
    }
  }

  it.each([
    ['client_msg_id', { client_msg_id: '' }, 'clientMsgId is required'],
    ['channel_id', { channel_id: '' }, 'channelId is required'],
    ['sender_id', { sender_id: '' }, 'senderId is required'],
  ] as const)(
    'rejects missing %s with INVALID_ARGUMENT',
    async (_field, overrides, message) => {
      await expectInvalidArgument(makeRequest(overrides), message);
      expect(messageService.createAndPersist).not.toHaveBeenCalled();
    },
  );

  it('rejects empty content for text messages with INVALID_ARGUMENT', async () => {
    await expectInvalidArgument(
      makeRequest({ content: '' }),
      'content is required for text messages',
    );
    expect(messageService.createAndPersist).not.toHaveBeenCalled();
  });

  it('forwards non-text messages without content validation', async () => {
    const request = makeRequest({
      type: 'file',
      content: '',
    });
    const response: CreateMessageResponse = {
      msgId: 'msg-1',
      seqId: '42',
      clientMsgId: request.client_msg_id,
      status: 'persisted',
      timestamp: 1234567890,
    };
    messageService.createAndPersist.mockResolvedValueOnce(response);

    await expect(controller.createMessage(request)).resolves.toEqual({
      msg_id: 'msg-1',
      seq_id: '42',
      client_msg_id: request.client_msg_id,
      status: 'persisted',
      timestamp: '1234567890',
      error: undefined,
    });

    expect(messageService.createAndPersist).toHaveBeenCalledWith({
      clientMsgId: request.client_msg_id,
      channelId: request.channel_id,
      senderId: request.sender_id,
      content: '',
      parentId: undefined,
      type: 'file',
      workspaceId: undefined,
      attachments: undefined,
      metadata: undefined,
    } satisfies CreateMessageDto);
  });

  it('converts attachments and metadata from snake_case to camelCase', async () => {
    const request = makeRequest({
      parent_id: 'parent-1',
      type: 'image',
      attachments: [
        {
          file_key: 'file-key-1',
          file_name: 'preview.png',
          file_size: '2048',
          mime_type: 'image/png',
        },
      ],
      metadata_json: JSON.stringify({
        source: 'mobile',
        retryCount: 2,
      }),
      workspace_id: 'workspace-1',
    });
    messageService.createAndPersist.mockResolvedValueOnce({
      msgId: 'msg-2',
      seqId: '77',
      clientMsgId: request.client_msg_id,
      status: 'persisted',
      timestamp: 1234567890,
    } satisfies CreateMessageResponse);

    await controller.createMessage(request);

    expect(messageService.createAndPersist).toHaveBeenCalledWith({
      clientMsgId: request.client_msg_id,
      channelId: request.channel_id,
      senderId: request.sender_id,
      content: request.content,
      parentId: 'parent-1',
      type: 'image',
      workspaceId: 'workspace-1',
      attachments: [
        {
          fileKey: 'file-key-1',
          fileName: 'preview.png',
          fileSize: 2048,
          mimeType: 'image/png',
        },
      ],
      metadata: {
        source: 'mobile',
        retryCount: 2,
      },
    } satisfies CreateMessageDto);
  });

  it('maps successful service responses to gRPC snake_case', async () => {
    const request = makeRequest();
    messageService.createAndPersist.mockResolvedValueOnce({
      msgId: 'msg-3',
      seqId: '88',
      clientMsgId: request.client_msg_id,
      status: 'persisted',
      timestamp: 1710000000,
      error: undefined,
    } satisfies CreateMessageResponse);

    await expect(controller.createMessage(request)).resolves.toEqual({
      msg_id: 'msg-3',
      seq_id: '88',
      client_msg_id: request.client_msg_id,
      status: 'persisted',
      timestamp: '1710000000',
      error: undefined,
    });
  });

  it('maps service failures to RpcException', async () => {
    messageService.createAndPersist.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    try {
      await controller.createMessage(makeRequest());
      throw new Error('Expected createMessage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        code: status.INTERNAL,
        message: 'database unavailable',
      });
    }

    expect((controller as any).logger.error).toHaveBeenCalledWith(
      'gRPC CreateMessage failed: Error: database unavailable',
    );
  });

  it('preserves service RpcException responses', async () => {
    const upstreamError = new RpcException({
      code: status.NOT_FOUND,
      message: 'channel not found',
    });
    messageService.createAndPersist.mockRejectedValueOnce(upstreamError);

    try {
      await controller.createMessage(makeRequest());
      throw new Error('Expected createMessage to throw');
    } catch (error) {
      expect(error).toBe(upstreamError);
      expect((error as RpcException).getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'channel not found',
      });
    }
  });

  it('returns a healthy gRPC status payload', () => {
    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(result.timestamp).toEqual(expect.any(String));
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
