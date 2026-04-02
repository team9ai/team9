import { IsEmail } from 'class-validator';

export class CreateEmailChangeDto {
  @IsEmail()
  newEmail: string;
}
