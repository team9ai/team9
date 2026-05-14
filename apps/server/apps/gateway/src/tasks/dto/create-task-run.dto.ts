import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTaskRunDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  botId?: string;
}
