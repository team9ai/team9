import { Module, Global } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

@Global()
@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      useFactory: () => {
        const host = process.env.RABBITMQ_HOST || 'localhost';
        const port = parseInt(process.env.RABBITMQ_PORT || '5672');
        const username = process.env.RABBITMQ_USER || 'guest';
        const password = process.env.RABBITMQ_PASSWORD || 'guest';
        const vhost = process.env.RABBITMQ_VHOST || '/';

        return {
          uri: `amqp://${username}:${password}@${host}:${port}${vhost}`,
          connectionInitOptions: { wait: false },
          enableControllerDiscovery: false,
        };
      },
    }),
  ],
  exports: [RabbitMQModule],
})
export class RabbitmqModule {}
