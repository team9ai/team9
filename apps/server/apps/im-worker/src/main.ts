import './instrument.js'; // Initialize Sentry before any other imports
import './otel.js'; // Initialize OpenTelemetry
import { NestFactory } from '@nestjs/core';
import { Logger, type INestApplication } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  MESSAGE_SERVICE_PROTO_PATH,
  bootstrapWithSchemaRetry,
} from '@team9/shared';
import { AppModule } from './app.module.js';

const logger = new Logger('ImWorkerService');

async function startApp(): Promise<void> {
  let app: INestApplication | undefined;
  try {
    // Create gRPC-only application
    app = await NestFactory.create(AppModule);

    // Use OTel logger when observability is enabled
    if (process.env.OTEL_ENABLED === 'true') {
      const { OtelLogger } = await import('@team9/observability');
      app.useLogger(new OtelLogger());
    }

    // Configure gRPC microservice on port 3001
    const grpcPort = process.env.IM_WORKER_PORT ?? 3001;

    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: {
        package: 'message',
        protoPath: MESSAGE_SERVICE_PROTO_PATH,
        // Use [::] to listen on both IPv4 and IPv6 (Railway uses IPv6 internal network)
        url: `[::]:${grpcPort}`,
        channelOptions: {
          'grpc.max_receive_message_length': 4 * 1024 * 1024, // 4 MB
          'grpc.max_send_message_length': 4 * 1024 * 1024, // 4 MB
        },
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
  } catch (err) {
    await app?.close().catch(() => {
      /* swallow teardown errors so the original error surfaces */
    });
    throw err;
  }
}

void bootstrapWithSchemaRetry(startApp, { logger });
