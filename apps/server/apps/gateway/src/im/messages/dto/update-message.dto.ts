import { IsString, MaxLength } from 'class-validator';

export class UpdateMessageDto {
  @IsString()
  @MaxLength(100000)
  content: string;
}
