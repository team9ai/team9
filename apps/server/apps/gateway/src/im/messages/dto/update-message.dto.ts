import { IsString, IsOptional, IsObject, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeMessageContent } from '../utils/sanitize-content.js';

export class UpdateMessageDto {
  @IsString()
  @MaxLength(100000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeMessageContent(value) : value,
  )
  content: string;

  @IsObject()
  @IsOptional()
  contentAst?: Record<string, unknown>;
}
