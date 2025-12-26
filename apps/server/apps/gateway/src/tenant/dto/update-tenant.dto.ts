import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import type { TenantSettings } from '@team9/database/schemas';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsEnum(['free', 'pro', 'enterprise'])
  plan?: 'free' | 'pro' | 'enterprise';

  @IsOptional()
  @IsObject()
  settings?: TenantSettings;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
