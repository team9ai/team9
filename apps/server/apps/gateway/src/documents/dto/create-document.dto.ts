import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DocumentPrivilege } from '@team9/database/schemas';

export class CreateDocumentDto {
  @IsString()
  @MaxLength(64)
  documentType: string;

  @IsString()
  content: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  title?: string;

  @IsArray()
  @IsOptional()
  privileges?: DocumentPrivilege[];
}
