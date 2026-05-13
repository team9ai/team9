import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { isAgentTimelineEventV1, WS_EVENTS } from '@team9/shared';
import { BotService } from '../../bot/bot.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { AgentTimelineService } from './agent-timeline.service.js';

@Controller({ path: 'im', version: '1' })
@UseGuards(AuthGuard)
export class AgentTimelineController {
  constructor(
    private readonly agentTimelineService: AgentTimelineService,
    private readonly channelsService: ChannelsService,
    private readonly botService: BotService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Post('agent-timeline/events')
  async ingestTimelineEvent(
    @CurrentUser('sub') userId: string,
    @Body() event: unknown,
  ) {
    const isBot = await this.botService.isBot(userId);
    if (!isBot) {
      return this.agentTimelineService.makeRejectedAck(
        event,
        'FORBIDDEN',
        false,
      );
    }

    if (!isAgentTimelineEventV1(event)) {
      return this.agentTimelineService.makeRejectedAck(
        event,
        'SCHEMA_VERSION_UNSUPPORTED',
        false,
      );
    }

    const isMember = await this.channelsService.isMember(
      event.channelId,
      userId,
    );
    if (!isMember) {
      return this.agentTimelineService.makeRejectedAck(
        event,
        'FORBIDDEN',
        false,
      );
    }

    const ack = await this.agentTimelineService.applyEvent(event);
    if (ack.ok) {
      const message = await this.websocketGateway.persistFinalTimelineResponse(
        event,
        userId,
      );
      if (event.kind === 'response' && event.op === 'end' && !message) {
        return {
          ...ack,
          ok: false,
          code: 'TRANSIENT_FAILURE',
          retryable: true,
        };
      }
    }

    if (
      ack.ok &&
      (ack.code !== 'STALE_SEQ' ||
        (event.kind === 'response' && event.op === 'end'))
    ) {
      await this.websocketGateway.sendToChannelMembers(
        event.channelId,
        WS_EVENTS.AGENT_TIMELINE.EVENT,
        event,
      );
    }

    return ack;
  }
}
