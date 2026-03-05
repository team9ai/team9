import {
  IsString,
  IsInt,
  IsIn,
  IsOptional,
  IsArray,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AgentTaskStepStatus } from '@team9/database/schemas';

export class StepReportItem {
  @IsInt()
  orderIndex: number;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsIn(['pending', 'in_progress', 'completed', 'failed'] as const)
  status: AgentTaskStepStatus;

  @IsInt()
  @IsOptional()
  tokenUsage?: number;

  @IsInt()
  @IsOptional()
  duration?: number;
}

export class ReportStepsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StepReportItem)
  steps: StepReportItem[];
}
