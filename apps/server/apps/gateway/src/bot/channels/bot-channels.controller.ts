import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannelsService } from '../../im/channels/channels.service.js';
import { CreateBotChannelDto } from '../../im/channels/dto/create-bot-channel.dto.js';
import { WS_EVENTS } from '../../im/websocket/events/events.constants.js';
import { WebsocketGateway } from '../../im/websocket/websocket.gateway.js';

@Controller({ path: 'bot/channels', version: '1' })
@UseGuards(AuthGuard)
export class BotChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Post()
  async createChannel(
    @CurrentUser('sub') botUserId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateBotChannelDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required in bot token');
    }

    const channel = await this.channelsService.createChannelForBot(
      botUserId,
      tenantId,
      dto,
    );

    if (dto.type === 'public') {
      // Public channel: broadcast to the whole workspace so everyone sees it
      await this.websocketGateway.broadcastToWorkspace(
        tenantId,
        WS_EVENTS.CHANNEL.CREATED,
        channel,
      );
    } else {
      // Private channel: fan out to each materialized member (bot + mentor + seeded members)
      const members = await this.channelsService.getChannelMembers(channel.id);
      await Promise.all(
        members.map((member) =>
          this.websocketGateway.sendToUser(
            member.userId,
            WS_EVENTS.CHANNEL.CREATED,
            channel,
          ),
        ),
      );
    }

    this.eventEmitter.emit('channel.created', { channel });
    return channel;
  }
}
