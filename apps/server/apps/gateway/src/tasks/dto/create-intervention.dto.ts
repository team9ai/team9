import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InterventionActionItem {
  @IsString()
  label: string;

  @IsString()
  value: string;
}

export class CreateInterventionDto {
  @IsString()
  prompt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterventionActionItem)
  actions: InterventionActionItem[];

  @IsUUID()
  @IsOptional()
  stepId?: string;
}
