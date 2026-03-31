import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUrl,
  IsEnum,
  Matches,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9-]+$/, {
    message:
      'Username can only contain lowercase letters, numbers, and hyphens',
  })
  @IsOptional()
  username?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(['online', 'offline', 'away', 'busy'])
  status: 'online' | 'offline' | 'away' | 'busy';
}
