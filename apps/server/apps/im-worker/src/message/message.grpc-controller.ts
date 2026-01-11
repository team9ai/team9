import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { MessageService } from './message.service.js';
import type { CreateMessageDto } from '@team9/shared';

// Proto message types (matching proto definition with snake_case)
interface GrpcAttachment {
  file_key: string;
  file_name: string;
  file_size: string; // int64 comes as string
  mime_type: string;
}

interface CreateMessageRequest {
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
  timestamp: string; // int64 as string
  error?: string;
}

interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * gRPC Controller for Message Service
 *
 * Handles gRPC calls from Gateway for message operations.
 * Uses the same MessageService business logic as HTTP controller.
 */
@Controller()
export class MessageGrpcController {
  private readonly logger = new Logger(MessageGrpcController.name);

  constructor(private readonly messageService: MessageService) {}

  /**
   * Create a new message via gRPC
   */
  @GrpcMethod('MessageService', 'CreateMessage')
  async createMessage(
    request: CreateMessageRequest,
  ): Promise<GrpcCreateMessageResponse> {
    this.logger.debug(`gRPC CreateMessage: ${request.client_msg_id}`);

    // Validate required fields
    if (!request.client_msg_id) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'clientMsgId is required',
      });
    }

    if (!request.channel_id) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'channelId is required',
      });
    }

    if (!request.sender_id) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'senderId is required',
      });
    }

    if (!request.content && request.type === 'text') {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'content is required for text messages',
      });
    }

    try {
      // Convert gRPC request (snake_case) to DTO (camelCase)
      const dto: CreateMessageDto = {
        clientMsgId: request.client_msg_id,
        channelId: request.channel_id,
        senderId: request.sender_id,
        content: request.content,
        parentId: request.parent_id,
        type: request.type as 'text' | 'file' | 'image',
        workspaceId: request.workspace_id,
        attachments: request.attachments?.map((att) => ({
          fileKey: att.file_key,
          fileName: att.file_name,
          fileSize: parseInt(att.file_size, 10),
          mimeType: att.mime_type,
        })),
        metadata: request.metadata_json
          ? JSON.parse(request.metadata_json)
          : undefined,
      };

      // Use existing business logic
      const result = await this.messageService.createAndPersist(dto);

      this.logger.debug(
        `gRPC Message created: ${result.msgId} (${result.status})`,
      );

      // Convert response to gRPC format (camelCase to snake_case)
      return {
        msg_id: result.msgId,
        seq_id: result.seqId,
        client_msg_id: result.clientMsgId,
        status: result.status,
        timestamp: result.timestamp.toString(),
        error: result.error,
      };
    } catch (error) {
      this.logger.error(`gRPC CreateMessage failed: ${error}`);
      throw new RpcException({
        code: status.INTERNAL,
        message: (error as Error).message || 'Failed to create message',
      });
    }
  }

  /**
   * Health check via gRPC
   */
  @GrpcMethod('MessageService', 'Health')
  health(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
