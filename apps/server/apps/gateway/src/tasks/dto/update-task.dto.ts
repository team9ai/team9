import {
  IsString,
  IsOptional,
  IsIn,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { RoutineScheduleType } from '@team9/database/schemas';
import { ScheduleConfigDto } from './create-task.dto.js';

export class UpdateTaskDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  title?: string;

  @IsUUID()
  @IsOptional()
  botId?: string | null;

  @IsString()
  @IsOptional()
  description?: string;

  /** @deprecated Use trigger CRUD API instead */
  @IsIn(['once', 'recurring'] as const)
  @IsOptional()
  scheduleType?: RoutineScheduleType;

  /** @deprecated Use trigger CRUD API instead */
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  @IsOptional()
  scheduleConfig?: ScheduleConfigDto;
}
