import { IsString, IsNumber, MaxLength, Max } from 'class-validator';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

export class CreatePresignedUploadDto {
  @IsString()
  @MaxLength(500)
  filename: string;

  @IsString()
  contentType: string;

  @IsNumber()
  @Max(MAX_FILE_SIZE)
  fileSize: number;
}

export class ConfirmUploadDto {
  @IsString()
  key: string;
}
