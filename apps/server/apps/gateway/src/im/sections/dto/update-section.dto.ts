import { IsString, MaxLength, IsOptional } from 'class-validator';

export class UpdateSectionDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;
}
