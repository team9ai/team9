import {
  IsString,
  IsOptional,
  IsUUID,
  IsIn,
  IsInt,
  Min,
  Max,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ScheduleConfig,
  AgentTaskScheduleType,
} from '@team9/database/schemas';
import { CreateTriggerDto } from './trigger.dto.js';

export class ScheduleConfigDto implements ScheduleConfig {
  @IsIn(['daily', 'weekly', 'monthly'] as const)
  @IsOptional()
  frequency?: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time must be in HH:mm format',
  })
  @IsOptional()
  time?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

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

  @IsString()
  @IsOptional()
  cron?: string;
}

export class CreateTaskDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsUUID()
  @IsOptional()
  botId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(['once', 'recurring'] as const)
  @IsOptional()
  scheduleType?: AgentTaskScheduleType;

  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  @IsOptional()
  scheduleConfig?: ScheduleConfigDto;

  @IsString()
  @IsOptional()
  documentContent?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateTriggerDto)
  @IsOptional()
  triggers?: CreateTriggerDto[];
}
