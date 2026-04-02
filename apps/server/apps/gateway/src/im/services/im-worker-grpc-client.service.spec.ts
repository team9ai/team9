import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { of, throwError } from 'rxjs';
import type { CreateMessageDto } from '@team9/shared';

const mockGetService = jest.fn<any>();
const mockClose = jest.fn<any>();
const mockGrpcClient = {
  getService: mockGetService,
  close: mockClose,
};
const mockCreate = jest.fn<any>(() => mockGrpcClient);

jest.unstable_mockModule('@nestjs/microservices', () => ({
  ClientProxyFactory: {
    create: mockCreate,
  },
  Transport: {
    GRPC: 'GRPC',
  },
}));

describe('ImWorkerGrpcClientService', () => {
  let ImWorkerGrpcClientService: typeof import('./im-worker-grpc-client.service.js').ImWorkerGrpcClientService;
  let service: import('./im-worker-grpc-client.service.js').ImWorkerGrpcClientService;
  let messageService: {
    createMessage: jest.Mock;
    health: jest.Mock;
  };

  const dto: CreateMessageDto = {
    clientMsgId: 'client-1',
    channelId: 'channel-1',
    senderId: 'user-1',
    content: 'hello',
    parentId: 'parent-1',
    type: 'text',
    workspaceId: 'workspace-1',
    attachments: [
      {
        fileKey: 'file-1',
        fileName: 'hello.txt',
        fileSize: 1234,
        mimeType: 'text/plain',
      },
    ],
    metadata: {
      mentions: ['user-2'],
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.IM_WORKER_GRPC_URL = 'im-worker:50052';
    process.env.IM_WORKER_GRPC_TIMEOUT = '4321';
    process.env.IM_WORKER_GRPC_RETRIES = '4';

    messageService = {
      createMessage: jest.fn<any>(),
      health: jest.fn<any>(),
    };
    mockGetService.mockReturnValue(messageService);
    mockCreate.mockImplementation(() => mockGrpcClient);

    ({ ImWorkerGrpcClientService } =
      await import('./im-worker-grpc-client.service.js'));
    service = new ImWorkerGrpcClientService();
  });

  it('initializes the gRPC client with the configured endpoint and service name', () => {
    service.onModuleInit();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'GRPC',
        options: expect.objectContaining({
          url: 'im-worker:50052',
        }),
      }),
    );
    expect(mockGetService).toHaveBeenCalledWith('MessageService');
  });

  it('rethrows initialization failures', () => {
    mockCreate.mockImplementationOnce(() => {
      throw new Error('init failed');
    });

    expect(() => service.onModuleInit()).toThrow('init failed');
  });

  it('closes the gRPC client on module destroy when close is available', () => {
    service.onModuleInit();

    service.onModuleDestroy();

    expect(mockClose).toHaveBeenCalled();
  });

  it('maps DTO fields to snake_case requests and converts the response back', async () => {
    service.onModuleInit();
    messageService.createMessage.mockReturnValue(
      of({
        msg_id: 'msg-1',
        seq_id: '42',
        client_msg_id: 'client-1',
        status: 'persisted',
        timestamp: '1730000000000',
      }),
    );

    await expect(service.createMessage(dto)).resolves.toEqual({
      msgId: 'msg-1',
      seqId: '42',
      clientMsgId: 'client-1',
      status: 'persisted',
      timestamp: 1730000000000,
      error: undefined,
    });

    expect(messageService.createMessage).toHaveBeenCalledWith({
      client_msg_id: 'client-1',
      channel_id: 'channel-1',
      sender_id: 'user-1',
      content: 'hello',
      parent_id: 'parent-1',
      type: 'text',
      workspace_id: 'workspace-1',
      attachments: [
        {
          file_key: 'file-1',
          file_name: 'hello.txt',
          file_size: '1234',
          mime_type: 'text/plain',
        },
      ],
      metadata_json: JSON.stringify(dto.metadata),
    });
  });

  it('wraps gRPC errors with a stable message', async () => {
    service.onModuleInit();
    messageService.createMessage.mockReturnValue(
      throwError(() => new Error('upstream down')),
    );

    await expect(service.createMessage(dto)).rejects.toThrow(
      'gRPC call failed: upstream down',
    );
  });

  it('returns true only when the health endpoint reports ok', async () => {
    service.onModuleInit();
    messageService.health
      .mockReturnValueOnce(
        of({
          status: 'ok',
          timestamp: '1',
        }),
      )
      .mockReturnValueOnce(
        of({
          status: 'degraded',
          timestamp: '2',
        }),
      )
      .mockReturnValueOnce(throwError(() => new Error('offline')));

    await expect(service.healthCheck()).resolves.toBe(true);
    await expect(service.healthCheck()).resolves.toBe(false);
    await expect(service.healthCheck()).resolves.toBe(false);
  });
});
