import { IsString, MaxLength, IsOptional } from 'class-validator';

export class UpdateSkillDto {
  @IsString()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  icon?: string;
}
