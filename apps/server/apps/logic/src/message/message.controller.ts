import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { MessageService } from './message.service.js';
import type { CreateMessageDto, CreateMessageResponse } from '@team9/shared';

/**
 * Message Controller - HTTP API for message operations
 *
 * This controller is called by Gateway nodes to create messages.
 * It provides synchronous message persistence with Outbox pattern
 * for guaranteed asynchronous delivery.
 */
@Controller('api/messages')
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(private readonly messageService: MessageService) {}

  /**
   * Create a new message
   *
   * POST /api/messages
   *
   * This endpoint:
   * 1. Validates the request
   * 2. Creates the message with Outbox pattern
   * 3. Returns msgId and seqId immediately
   * 4. Message delivery is handled asynchronously by OutboxProcessor
   */
  @Post()
  async createMessage(
    @Body() dto: CreateMessageDto,
  ): Promise<CreateMessageResponse> {
    // Validate required fields
    if (!dto.clientMsgId) {
      throw new HttpException(
        'clientMsgId is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!dto.channelId) {
      throw new HttpException('channelId is required', HttpStatus.BAD_REQUEST);
    }

    if (!dto.senderId) {
      throw new HttpException('senderId is required', HttpStatus.BAD_REQUEST);
    }

    if (!dto.content && dto.type === 'text') {
      throw new HttpException(
        'content is required for text messages',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.messageService.createAndPersist(dto);

      this.logger.debug(
        `Message created: ${result.msgId} (${result.status}) for channel ${dto.channelId}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to create message: ${error}`);
      throw new HttpException(
        (error as Error).message || 'Failed to create message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
