import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DmOutboundPolicyDto } from './dm-outbound-policy.dto.js';

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
   * Optional — when omitted, the service falls back in this order:
   * roleTitle → "Candidate #N" (agenticBootstrap only) → "New Staff".
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
  mentorId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DmOutboundPolicyDto)
  dmOutboundPolicy?: DmOutboundPolicyDto;
}
