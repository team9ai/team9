import { Module, Global } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { env, MQ_EXCHANGES } from '@team9/shared';
import { RabbitMQEventService } from './rabbitmq-event.service.js';
import { GatewayMQService } from './gateway/gateway-mq.service.js';
import { RABBITMQ_EXCHANGES } from './constants/queues.js';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    RabbitMQModule.forRootAsync({
      useFactory: () => {
        const host = env.RABBITMQ_HOST;
        const port = env.RABBITMQ_PORT;
        const username = env.RABBITMQ_USER;
        const password = env.RABBITMQ_PASSWORD;
        const vhost = env.RABBITMQ_VHOST;
        return {
          uri: `amqp://${username}:${password}@${host}:${port}${vhost}`,
          connectionInitOptions: { wait: true, reject: true, timeout: 30000 },
          enableControllerDiscovery: true,
          prefetchCount: 10,
          channels: {
            'im-channel': {
              prefetchCount: 20,
              default: true,
            },
            'notification-channel': {
              prefetchCount: 10,
            },
          },
          exchanges: [
            // ========== IM Messaging Exchanges ==========
            // Downstream messages: im-worker -> Gateway (for WebSocket delivery)
            {
              name: MQ_EXCHANGES.IM_TOPIC,
              type: 'topic',
              options: { durable: true },
            },
            // Upstream messages: Gateway -> im-worker (for processing)
            {
              name: MQ_EXCHANGES.IM_UPSTREAM,
              type: 'direct',
              options: { durable: true },
            },
            // Dead letter exchange for failed messages
            {
              name: MQ_EXCHANGES.IM_DLX,
              type: 'direct',
              options: { durable: true },
            },
            // Broadcast messages to all gateways (e.g., large group messages)
            {
              name: MQ_EXCHANGES.IM_BROADCAST,
              type: 'fanout',
              options: { durable: true },
            },

            // ========== Workspace Exchanges ==========
            {
              name: RABBITMQ_EXCHANGES.WORKSPACE_EVENTS,
              type: 'topic',
              options: { durable: true },
            },

            // ========== Notification Exchanges ==========
            // Notification tasks: message events -> im-worker (for processing)
            {
              name: RABBITMQ_EXCHANGES.NOTIFICATION_EVENTS,
              type: 'topic',
              options: { durable: true },
            },
            // Notification delivery: im-worker -> Gateway (for WebSocket push)
            {
              name: RABBITMQ_EXCHANGES.NOTIFICATION_DELIVERY,
              type: 'topic',
              options: { durable: true },
            },
          ],
        };
      },
    }),
  ],
  providers: [RabbitMQEventService, GatewayMQService],
  exports: [RabbitMQModule, RabbitMQEventService, GatewayMQService],
})
export class RabbitmqModule {}
