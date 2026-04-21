import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class BotUserSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export interface BotUserSearchResultItem {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface BotUserSearchResponse {
  results: BotUserSearchResultItem[];
}
