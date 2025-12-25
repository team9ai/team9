import { Module, Global, Logger, OnModuleDestroy } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './storage.constants.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      useFactory: () => {
        const logger = new Logger('StorageModule');

        const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
        const region = process.env.S3_REGION || 'us-east-1';
        const accessKeyId =
          process.env.S3_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'admin';
        const secretAccessKey =
          process.env.S3_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || '';

        logger.log(`Connecting to S3-compatible storage at ${endpoint}`);

        const client = new S3Client({
          endpoint,
          region,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
          forcePathStyle: true, // Required for MinIO
        });

        logger.log('S3 client initialized successfully');

        return client;
      },
    },
    StorageService,
  ],
  exports: [S3_CLIENT, StorageService],
})
export class StorageModule implements OnModuleDestroy {
  constructor(private readonly storageService: StorageService) {}

  onModuleDestroy() {
    const client = this.storageService.getClient();
    client.destroy();
  }
}
