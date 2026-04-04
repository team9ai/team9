import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ModelDto {
  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsString()
  @IsNotEmpty()
  id: string;
}

export class CreateCommonStaffDto {
  /**
   * Display name for the staff member.
   * Optional when agenticBootstrap is true — the service will auto-generate
   * a temporary name (e.g. "Candidate #1") in that case.
   */
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  mentorId?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @ValidateNested()
  @Type(() => ModelDto)
  model: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  agenticBootstrap?: boolean;
}

export class UpdateCommonStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  mentorId?: string;
}
