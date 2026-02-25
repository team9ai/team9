import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import type { DocumentSuggestionData } from '@team9/database/schemas';

export class SubmitSuggestionDto {
  @IsObject()
  data: DocumentSuggestionData;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  summary?: string;
}
