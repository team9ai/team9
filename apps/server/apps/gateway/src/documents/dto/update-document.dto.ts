import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateDocumentDto {
  @IsString()
  content: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  summary?: string;
}
