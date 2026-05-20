import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTaskRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}
