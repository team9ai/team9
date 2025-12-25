import {
  IsString,
  MaxLength,
  IsOptional,
  IsEnum,
  IsUrl,
} from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @IsEnum(['public', 'private'])
  type: 'public' | 'private';

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
}
