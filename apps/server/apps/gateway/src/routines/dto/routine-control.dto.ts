import { IsString, IsOptional } from 'class-validator';

export class StartRoutineDto {
  @IsString()
  @IsOptional()
  message?: string;
}

export class ResumeRoutineDto {
  @IsString()
  @IsOptional()
  message?: string;
}

export class StopRoutineDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
