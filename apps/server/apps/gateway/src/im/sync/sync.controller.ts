import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { SyncService } from './sync.service.js';
import { SyncAckDto } from './dto/sync.dto.js';
import type { SyncMessagesResponse } from '@team9/shared';

@Controller({
  path: 'im/sync',
  version: '1',
})
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /**
   * Sync messages for a specific channel (lazy loading)
   * Called when user opens a channel
   */
  @Get('channel/:channelId')
  async syncChannel(
    @CurrentUser('sub') userId: string,
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
  ): Promise<SyncMessagesResponse> {
    const messageLimit = limit ? parseInt(limit, 10) : 50;
    return this.syncService.syncChannel(userId, channelId, messageLimit);
  }

  /**
   * Manually acknowledge sync position for a channel
   * Optional - syncChannel already updates position automatically
   */
  @Post('ack')
  async ackSync(
    @CurrentUser('sub') userId: string,
    @Body() dto: SyncAckDto,
  ): Promise<{ success: boolean }> {
    await this.syncService.updateSyncPosition(
      userId,
      dto.channelId,
      BigInt(dto.seqId),
    );
    return { success: true };
  }
}
