import {
  IsString,
  IsOptional,
  IsNumber,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class AddDeliverableDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @IsUrl()
  fileUrl!: string;
}
