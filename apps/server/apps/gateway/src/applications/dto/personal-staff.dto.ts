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
}
