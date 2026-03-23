import { Global, Module } from '@nestjs/common';
import { ChannelMemberCacheService } from './channel-member-cache.service.js';
import { ChannelSequenceService } from './channel-sequence.service.js';

@Global()
@Module({
  providers: [ChannelMemberCacheService, ChannelSequenceService],
  exports: [ChannelMemberCacheService, ChannelSequenceService],
})
export class ImSharedModule {}
