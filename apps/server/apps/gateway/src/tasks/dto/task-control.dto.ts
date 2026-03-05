import { IsString, IsOptional } from 'class-validator';

export class StartTaskDto {
  @IsString()
  @IsOptional()
  message?: string;
}

export class ResumeTaskDto {
  @IsString()
  @IsOptional()
  message?: string;
}

export class StopTaskDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
