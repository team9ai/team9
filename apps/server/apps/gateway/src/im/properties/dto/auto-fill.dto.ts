import { IsOptional, IsArray, IsString, IsBoolean } from 'class-validator';

export class AutoFillDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @IsBoolean()
  preserveExisting?: boolean;
}
