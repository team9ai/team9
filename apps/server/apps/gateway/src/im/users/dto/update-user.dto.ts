import {
  IsString,
  MaxLength,
  IsOptional,
  IsUrl,
  IsEnum,
} from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  displayName?: string;

  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(['online', 'offline', 'away', 'busy'])
  status: 'online' | 'offline' | 'away' | 'busy';
}
