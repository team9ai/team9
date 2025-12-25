import {
  IsString,
  MaxLength,
  IsOptional,
  IsUrl,
  IsBoolean,
} from 'class-validator';

export class UpdateChannelDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @IsBoolean()
  @IsOptional()
  isArchived?: boolean;
}
