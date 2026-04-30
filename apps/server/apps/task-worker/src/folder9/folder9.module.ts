import { Module } from '@nestjs/common';
import { Folder9Client } from './folder9.client.js';

/**
 * Provides the local folder9 HTTP client to other modules in the task-worker.
 *
 * Stateless singleton — no DI deps beyond reading process.env via
 * `@team9/shared`'s `env` accessor.
 */
@Module({
  providers: [Folder9Client],
  exports: [Folder9Client],
})
export class Folder9Module {}
