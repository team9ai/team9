import { Global, Module } from '@nestjs/common';
import { PosthogService } from './posthog.service.js';

@Global()
@Module({
  providers: [PosthogService],
  exports: [PosthogService],
})
export class PosthogModule {}
