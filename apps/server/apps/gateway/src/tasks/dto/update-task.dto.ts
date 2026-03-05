import {
  IsString,
  IsOptional,
  IsIn,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AgentTaskScheduleType } from '@team9/database/schemas';
import { ScheduleConfigDto } from './create-task.dto.js';

export class UpdateTaskDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  title?: string;

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
}
