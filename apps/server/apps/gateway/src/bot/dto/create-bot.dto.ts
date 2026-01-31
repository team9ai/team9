import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
  IsUrl,
} from 'class-validator';

export class CreateBotDto {
  @IsString()
  @MaxLength(100)
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
