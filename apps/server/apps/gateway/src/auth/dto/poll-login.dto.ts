import { IsString, IsNotEmpty } from 'class-validator';

export class PollLoginDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;
}
