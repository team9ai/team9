import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class AuthStartDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
