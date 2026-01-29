import { IsEmail } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail()
  email: string;
}
