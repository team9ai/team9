import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ClientGrpc,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import {
  Observable,
  firstValueFrom,
  timeout,
  retry,
  catchError,
  throwError,
} from 'rxjs';
import {
  MESSAGE_SERVICE_PROTO_PATH,
  type CreateMessageDto,
  type CreateMessageResponse,
} from '@team9/shared';

// gRPC request/response types (snake_case matching proto)
interface GrpcAttachment {
  file_key: string;
  file_name: string;
  file_size: string;
  mime_type: string;
}

interface GrpcCreateMessageRequest {
  client_msg_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  parent_id?: string;
  type: string;
  attachments?: GrpcAttachment[];
  metadata_json?: string;
  workspace_id?: string;
}

interface GrpcCreateMessageResponse {
  msg_id: string;
  seq_id: string;
  client_msg_id: string;
  status: string;
  timestamp: string;
  error?: string;
}

interface GrpcHealthResponse {
  status: string;
  timestamp: string;
}

// gRPC service interface
interface MessageServiceClient {
  createMessage(
    request: GrpcCreateMessageRequest,
  ): Observable<GrpcCreateMessageResponse>;
  health(request: Record<string, never>): Observable<GrpcHealthResponse>;
}

/**
 * gRPC Client Service for IM Worker
 *
 * Provides gRPC communication with IM Worker Service for message operations.
 * Replaces HTTP-based ImWorkerClientService with better performance.
 */
@Injectable()
export class ImWorkerGrpcClientService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ImWorkerGrpcClientService.name);
  private messageService!: MessageServiceClient;
  private grpcClient!: ClientGrpc;

  private readonly grpcUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor() {
    this.grpcUrl = process.env.IM_WORKER_GRPC_URL || 'localhost:3001';
    this.timeoutMs = parseInt(process.env.IM_WORKER_GRPC_TIMEOUT || '5000', 10);
    this.maxRetries = parseInt(process.env.IM_WORKER_GRPC_RETRIES || '2', 10);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Initializing gRPC client, targeting: ${this.grpcUrl}`);

    try {
      // Create gRPC client
      this.grpcClient = ClientProxyFactory.create({
        transport: Transport.GRPC,
        options: {
          package: 'message',
          protoPath: MESSAGE_SERVICE_PROTO_PATH,
          url: this.grpcUrl,
          loader: {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
          },
        },
      }) as ClientGrpc;

      this.messageService =
        this.grpcClient.getService<MessageServiceClient>('MessageService');

      this.logger.log('gRPC client initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize gRPC client: ${error}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Close gRPC connection if needed
    if (
      this.grpcClient &&
      typeof (this.grpcClient as unknown as { close?: () => void }).close ===
        'function'
    ) {
      (this.grpcClient as unknown as { close: () => void }).close();
    }
  }

  /**
   * Create a message via IM Worker Service gRPC API
   */
  async createMessage(dto: CreateMessageDto): Promise<CreateMessageResponse> {
    // Convert DTO (camelCase) to gRPC request format (snake_case)
    const request: GrpcCreateMessageRequest = {
      client_msg_id: dto.clientMsgId,
      channel_id: dto.channelId,
      sender_id: dto.senderId,
      content: dto.content,
      parent_id: dto.parentId,
      type: dto.type,
      workspace_id: dto.workspaceId,
      attachments: dto.attachments?.map((att) => ({
        file_key: att.fileKey,
        file_name: att.fileName,
        file_size: att.fileSize.toString(),
        mime_type: att.mimeType,
      })),
      metadata_json: dto.metadata ? JSON.stringify(dto.metadata) : undefined,
    };

    try {
      const response = await firstValueFrom(
        this.messageService.createMessage(request).pipe(
          timeout(this.timeoutMs),
          retry({
            count: this.maxRetries,
            delay: 100, // 100ms between retries
          }),
          catchError((error) => {
            this.logger.error(`gRPC createMessage failed: ${error.message}`);
            return throwError(() => error);
          }),
        ),
      );

      this.logger.debug(
        `Message created via gRPC: ${response.msg_id} (${response.status})`,
      );

      // Convert gRPC response (snake_case) to DTO format (camelCase)
      return {
        msgId: response.msg_id,
        seqId: response.seq_id,
        clientMsgId: response.client_msg_id,
        status: response.status as 'persisted' | 'duplicate',
        timestamp: parseInt(response.timestamp, 10),
        error: response.error,
      };
    } catch (error) {
      this.logger.error(`Failed to create message via gRPC: ${error}`);
      throw new Error(`gRPC call failed: ${(error as Error).message}`);
    }
  }

  /**
   * Health check for IM Worker Service via gRPC
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.messageService.health({}).pipe(timeout(2000)),
      );
      return response.status === 'ok';
    } catch {
      return false;
    }
  }
}
