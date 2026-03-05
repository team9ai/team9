import {
  IsString,
  IsOptional,
  IsUUID,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ScheduleConfig,
  AgentTaskScheduleType,
} from '@team9/database/schemas';

export class ScheduleConfigDto implements ScheduleConfig {
  @IsString()
  @IsOptional()
  frequency?: string;

  @IsString()
  @IsOptional()
  time?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsOptional()
  dayOfWeek?: number;

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
  botId: string;

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
}
