import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/, {
    message:
      'Username can only contain lowercase letters, numbers, and underscores',
  })
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
