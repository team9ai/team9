import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  MaxLength,
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
}
