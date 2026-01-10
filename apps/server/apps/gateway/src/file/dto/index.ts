import {
  IsString,
  IsNumber,
  MaxLength,
  Max,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

export type FileVisibility = 'private' | 'channel' | 'workspace' | 'public';

export class CreatePresignedUploadDto {
  @IsString()
  @MaxLength(500)
  filename: string;

  @IsString()
  contentType: string;

  @IsNumber()
  @Max(MAX_FILE_SIZE)
  fileSize: number;

  @IsEnum(['private', 'channel', 'workspace', 'public'])
  @IsOptional()
  visibility?: FileVisibility;

  @IsUUID()
  @IsOptional()
  channelId?: string;
}

export class ConfirmUploadDto {
  @IsString()
  key: string;

  @IsString()
  @MaxLength(500)
  fileName: string;

  @IsEnum(['private', 'channel', 'workspace', 'public'])
  @IsOptional()
  visibility?: FileVisibility;

  @IsUUID()
  @IsOptional()
  channelId?: string;
}

export class GetDownloadUrlDto {
  @IsNumber()
  @IsOptional()
  @Max(86400) // Max 24 hours
  expiresIn?: number;
}
