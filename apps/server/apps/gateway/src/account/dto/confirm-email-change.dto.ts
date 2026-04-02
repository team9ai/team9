import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
