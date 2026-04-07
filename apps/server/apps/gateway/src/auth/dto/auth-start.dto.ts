import {
  IsEmail,
  IsIn,
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
}
