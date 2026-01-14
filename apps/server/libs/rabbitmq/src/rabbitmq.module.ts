import { Module, Global, OnModuleInit } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { env } from '@team9/shared';
import { RabbitMQEventService } from './rabbitmq-event.service.js';
import { GatewayMQService } from './gateway/gateway-mq.service.js';

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
          connectionInitOptions: { wait: true },
          enableControllerDiscovery: false,
        };
      },
    }),
  ],
  providers: [RabbitMQEventService, GatewayMQService],
  exports: [RabbitMQModule, RabbitMQEventService, GatewayMQService],
})
export class RabbitmqModule implements OnModuleInit {
  constructor(private readonly rabbitMQEventService: RabbitMQEventService) {}

  async onModuleInit() {
    // Setup queues and exchanges on module initialization
    await this.rabbitMQEventService.setupQueuesAndExchanges();
  }
}
