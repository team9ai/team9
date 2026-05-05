import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { JsonMaxSize } from './validators.js';

export class DecideRequestDto {
  @IsEnum(['once', 'remember', 'deny'])
  decision!: 'once' | 'remember' | 'deny';

  @IsOptional()
  @IsObject()
  @Validate(JsonMaxSize, [4096])
  scopeOverride?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(['agent', 'channel-session', 'execution-session', 'task'])
  rememberSubject?: 'agent' | 'channel-session' | 'execution-session' | 'task';

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
