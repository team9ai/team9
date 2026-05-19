import {
  IsString,
  IsUUID,
  IsOptional,
  IsNotEmpty,
  IsObject,
  MaxLength,
} from 'class-validator';

const MAX_STREAMING_TEXT_LENGTH = 600000;

export class StartStreamingDto {
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateStreamingContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STREAMING_TEXT_LENGTH)
  content: string;
}

export class UpdateStreamingThinkingContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STREAMING_TEXT_LENGTH)
  content: string;
}

export class UpdateStreamingMetadataDto {
  @IsObject()
  metadata: Record<string, unknown>;
}

export class EndStreamingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STREAMING_TEXT_LENGTH)
  content: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_STREAMING_TEXT_LENGTH)
  thinking?: string;
}
