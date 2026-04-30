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
import { ScheduleConfigDto } from './create-routine.dto.js';
import { CreateTriggerDto } from './trigger.dto.js';

export class UpdateRoutineDto {
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

  @ValidateNested({ each: true })
  @Type(() => CreateTriggerDto)
  @IsOptional()
  triggers?: CreateTriggerDto[];

  @IsIn(['draft', 'upcoming'] as const)
  @IsOptional()
  status?: 'draft' | 'upcoming';
}
