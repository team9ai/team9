import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateBotChannelDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEnum(['public', 'private'])
  type: 'public' | 'private';

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  description?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @IsUUID()
  @IsOptional()
  sectionId?: string;

  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  memberUserIds?: string[];
}
