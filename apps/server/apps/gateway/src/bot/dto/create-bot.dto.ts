import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MinLength,
  MaxLength,
  Matches,
  IsUrl,
} from 'class-validator';

export class CreateBotDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/, {
    message:
      'Username can only contain lowercase letters, numbers, and underscores',
  })
  username: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsEnum(['custom', 'webhook'])
  @IsOptional()
  type?: 'custom' | 'webhook';

  @IsUrl()
  @IsOptional()
  webhookUrl?: string;

  @IsBoolean()
  @IsOptional()
  generateToken?: boolean;
}
