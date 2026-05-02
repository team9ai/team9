import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class DecideRequestDto {
  @IsEnum(['once', 'remember', 'deny'])
  decision!: 'once' | 'remember' | 'deny';

  @IsOptional()
  @IsObject()
  scopeOverride?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(['agent', 'channel-session', 'execution-session', 'task'])
  rememberSubject?: 'agent' | 'channel-session' | 'execution-session' | 'task';

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
