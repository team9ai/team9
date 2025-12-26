import {
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsEnum(['free', 'pro', 'enterprise'])
  plan?: 'free' | 'pro' | 'enterprise';
}
