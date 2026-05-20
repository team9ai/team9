import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export type TaskRunTriggerMode = 'immediate' | 'scheduled' | 'create_only';

export class CreateTaskRunDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  botId?: string;

  @IsOptional()
  @IsBoolean()
  executeImmediately?: boolean;

  @IsOptional()
  @IsIn(['immediate', 'scheduled', 'create_only'])
  triggerMode?: TaskRunTriggerMode;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}
