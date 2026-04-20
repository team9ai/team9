import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AuthStartDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['self', 'invite'])
  signupSource?: 'self' | 'invite';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  turnstileToken?: string;
}
