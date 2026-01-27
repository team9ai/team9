import { IsString, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ChannelSyncRequestItem {
  @IsString()
  channelId: string;

  @IsString()
  afterSeqId: string;
}

export class SyncPullDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelSyncRequestItem)
  channels: ChannelSyncRequestItem[];

  @IsOptional()
  @IsString()
  limit?: string;
}

export class SyncAckDto {
  @IsString()
  channelId: string;

  @IsString()
  seqId: string;
}
