import { IsString, MaxLength } from 'class-validator';

export class CreateSectionDto {
  @IsString()
  @MaxLength(100)
  name: string;
}
