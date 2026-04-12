import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteCreationDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
