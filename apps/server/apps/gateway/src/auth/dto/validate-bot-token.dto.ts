import { IsNotEmpty, IsString } from 'class-validator';

export class ValidateBotTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
