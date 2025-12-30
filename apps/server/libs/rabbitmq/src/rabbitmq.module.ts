import { Module, Global, OnModuleInit } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { env } from '@team9/shared';
import { RabbitMQEventService } from './rabbitmq-event.service.js';

@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      useFactory: () => {
        const host = env.RABBITMQ_HOST;
        const port = env.RABBITMQ_PORT;
        const username = env.RABBITMQ_USER;
        const password = env.RABBITMQ_PASSWORD;
        const vhost = env.RABBITMQ_VHOST;

        return {
          uri: `amqp://${username}:${password}@${host}:${port}${vhost}`,
          connectionInitOptions: { wait: false },
          enableControllerDiscovery: false,
        };
      },
    }),
  ],
  providers: [RabbitMQEventService],
  exports: [RabbitMQModule, RabbitMQEventService],
})
export class RabbitmqModule implements OnModuleInit {
  constructor(private readonly rabbitMQEventService: RabbitMQEventService) {}

  async onModuleInit() {
    // Setup queues and exchanges on module initialization
    await this.rabbitMQEventService.setupQueuesAndExchanges();
  }
}
