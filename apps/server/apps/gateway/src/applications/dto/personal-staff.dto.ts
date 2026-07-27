import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DmOutboundPolicyDto } from './dm-outbound-policy.dto.js';

class ModelDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(128)
  provider: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(256)
  id: string;
}

export class VisibilityDto {
  @IsOptional()
  @IsBoolean()
  allowMention?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDirectMessage?: boolean;
}

export class CreatePersonalStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsDefined()
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

export class UpdatePersonalStaffDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelDto)
  model?: ModelDto;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VisibilityDto)
  visibility?: VisibilityDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DmOutboundPolicyDto)
  dmOutboundPolicy?: DmOutboundPolicyDto;
}
