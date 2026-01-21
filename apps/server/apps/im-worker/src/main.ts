import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { MESSAGE_SERVICE_PROTO_PATH } from '@team9/shared';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('ImWorkerService');

  // Create gRPC-only application
  const app = await NestFactory.create(AppModule);

  // Configure gRPC microservice on port 3001
  const grpcPort = process.env.IM_WORKER_PORT ?? 3001;

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'message',
      protoPath: MESSAGE_SERVICE_PROTO_PATH,
      // Use [::] to listen on both IPv4 and IPv6 (Railway uses IPv6 internal network)
      url: `[::]:${grpcPort}`,
      loader: {
        keepCase: true, // Keep snake_case from proto
        longs: String, // Convert int64 to string
        enums: String,
        defaults: true,
        oneofs: true,
      },
    },
  });

  // Initialize the application to trigger RabbitMQ handler registration
  // This is required for @RabbitSubscribe decorators to work properly
  await app.init();

  // Start gRPC microservice
  await app.startAllMicroservices();

  logger.log(`IM Worker Service gRPC is running on port ${grpcPort}`);
}

void bootstrap();
