import { IsString, MaxLength } from 'class-validator';

export class AddReactionDto {
  @IsString()
  @MaxLength(50)
  emoji: string;
}
