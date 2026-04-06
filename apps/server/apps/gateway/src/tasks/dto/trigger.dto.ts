import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsBoolean,
  Min,
  Max,
  Matches,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { RoutineTriggerType } from '@team9/database/schemas';

export class IntervalConfigDto {
  @IsInt()
  @Min(1)
  every: number;

  @IsIn(['minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const)
  unit: string;
}

export class ScheduleConfigNewDto {
  @IsIn(['daily', 'weekly', 'monthly', 'yearly', 'weekdays'] as const)
  frequency: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time must be in HH:mm format',
  })
  time: string;

  @IsString()
  timezone: string;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  dayOfWeek?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  dayOfMonth?: number;
}

export class ChannelMessageConfigDto {
  @IsUUID()
  channelId: string;
}

export class CreateTriggerDto {
  @IsIn(['manual', 'interval', 'schedule', 'channel_message'] as const)
  type: RoutineTriggerType;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateTriggerDto {
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class StartTaskNewDto {
  @IsString()
  @IsOptional()
  notes?: string;

  @IsUUID()
  @IsOptional()
  triggerId?: string;

  @IsString()
  @IsOptional()
  message?: string;
}

export class RestartTaskDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class RetryExecutionDto {
  @IsUUID()
  executionId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
