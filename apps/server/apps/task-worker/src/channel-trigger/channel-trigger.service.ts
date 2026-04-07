import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitSubscribe,
  RABBITMQ_EXCHANGES,
  RABBITMQ_QUEUES,
  RABBITMQ_ROUTING_KEYS,
} from '@team9/rabbitmq';
import { MQ_EXCHANGES } from '@team9/shared';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ChannelMessageTriggerConfig } from '@team9/database/schemas';
import { ExecutorService } from '../executor/executor.service.js';

interface MessageCreatedEvent {
  channelId: string;
  messageId: string;
  content?: string;
  messageType?: 'text' | 'file' | 'image' | 'system' | 'tracking';
  senderId: string;
  senderUserType?: 'human' | 'bot' | 'system' | null;
  senderAgentType?: 'base_model' | 'openclaw' | null;
}

@Injectable()
export class ChannelTriggerService implements OnModuleInit {
  private readonly logger = new Logger(ChannelTriggerService.name);
  private channelTriggerMap = new Map<string, schema.RoutineTrigger[]>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly executor: ExecutorService,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.logger.log(
      `Loaded ${this.channelTriggerMap.size} channel(s) with message triggers`,
    );
  }

  async refresh(): Promise<void> {
    const triggers = await this.db
      .select()
      .from(schema.routineTriggers)
      .where(
        and(
          eq(schema.routineTriggers.type, 'channel_message'),
          eq(schema.routineTriggers.enabled, true),
        ),
      );

    this.channelTriggerMap.clear();
    for (const trigger of triggers) {
      const config = trigger.config as ChannelMessageTriggerConfig;
      if (!config?.channelId) continue;
      const list = this.channelTriggerMap.get(config.channelId) ?? [];
      list.push(trigger);
      this.channelTriggerMap.set(config.channelId, list);
    }
  }

  private shouldTriggerForMessage(msg: MessageCreatedEvent): boolean {
    return msg.senderUserType === 'human' && msg.senderAgentType === null;
  }

  @RabbitSubscribe({
    exchange: RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
    routingKey: RABBITMQ_ROUTING_KEYS.MESSAGE_CREATED,
    queue: RABBITMQ_QUEUES.TASK_WORKER_MESSAGE_EVENTS,
    queueOptions: {
      durable: true,
      deadLetterExchange: MQ_EXCHANGES.IM_DLX,
      deadLetterRoutingKey: 'dlq.task-message-trigger',
    },
  })
  async handleMessage(msg: MessageCreatedEvent): Promise<void> {
    const triggers = this.channelTriggerMap.get(msg.channelId);
    if (!triggers?.length) return;

    if (!this.shouldTriggerForMessage(msg)) {
      this.logger.debug(
        `Skipping channel-message triggers for non-human-authored message ${msg.messageId} from ${msg.senderId}`,
      );
      return;
    }

    this.logger.log(
      `Message in channel ${msg.channelId} matched ${triggers.length} trigger(s)`,
    );

    for (const trigger of triggers) {
      try {
        await this.executor.triggerExecution(trigger.routineId, {
          triggerId: trigger.id,
          triggerType: 'channel_message',
          triggerContext: {
            triggeredAt: new Date().toISOString(),
            channelId: msg.channelId,
            messageId: msg.messageId,
            messageContent: msg.content?.slice(0, 500),
            messageType: msg.messageType,
            senderId: msg.senderId,
            senderUserType: msg.senderUserType ?? null,
            senderAgentType: msg.senderAgentType ?? null,
          },
        });

        // Update lastRunAt on the trigger
        await this.db
          .update(schema.routineTriggers)
          .set({
            lastRunAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.routineTriggers.id, trigger.id));
      } catch (error) {
        this.logger.error(
          `Failed to trigger execution for trigger ${trigger.id}: ${error}`,
        );
      }
    }
  }
}
