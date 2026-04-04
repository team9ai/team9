import {
  IsString,
  IsOptional,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ModelDto {
  @IsString()
  provider: string;

  @IsString()
  id: string;
}

export class CreateCommonStaffDto {
  @IsString()
  displayName: string;

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
