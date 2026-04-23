import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchQueryDto {
  @IsString()
  q: string; // Main search query with optional filters

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number;

  @IsOptional()
  @IsIn(['message', 'channel', 'user', 'file'])
  type?: 'message' | 'channel' | 'user' | 'file';

  /** Restrict message search to a specific channel (for message_ref scope=same_channel) */
  @IsOptional()
  @IsUUID()
  channelId?: string;
}
