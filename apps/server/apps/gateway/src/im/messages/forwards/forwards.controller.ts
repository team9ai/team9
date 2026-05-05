import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { ForwardsService } from './forwards.service.js';
import { CreateForwardDto } from './dto/create-forward.dto.js';
import type { MessageResponse } from '../messages.service.js';
import type { ForwardItemResponse } from './types.js';

@Controller({ path: 'im', version: '1' })
@UseGuards(AuthGuard)
export class ForwardsController {
  constructor(private readonly forwardsService: ForwardsService) {}

  @Post('channels/:targetChannelId/forward')
  async forward(
    @CurrentUser('sub') userId: string,
    @Param('targetChannelId', ParseUUIDPipe) targetChannelId: string,
    @Body() dto: CreateForwardDto,
  ): Promise<MessageResponse> {
    return this.forwardsService.forward({
      targetChannelId,
      sourceChannelId: dto.sourceChannelId,
      sourceMessageIds: dto.sourceMessageIds,
      clientMsgId: dto.clientMsgId,
      userId,
    });
  }

  @Get('messages/:id/forward-items')
  async getItems(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ): Promise<ForwardItemResponse[]> {
    return this.forwardsService.getForwardItems(messageId, userId);
  }
}
