import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsObject,
  ValidateNested,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDto {
  @IsString()
  fileKey: string;

  @IsString()
  @MaxLength(500)
  fileName: string;

  @IsString()
  mimeType: string;

  @IsNumber() // in bytes
  fileSize: number;
}

export class CreateMessageDto {
  @IsString()
  @MaxLength(10000)
  content: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  @IsOptional()
  attachments?: AttachmentDto[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
