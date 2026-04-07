import {
  IsString,
  IsUUID,
  IsOptional,
  IsNotEmpty,
  IsObject,
  MaxLength,
} from 'class-validator';

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
  @MaxLength(100000)
  content: string;
}

export class UpdateStreamingThinkingContentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content: string;
}

export class EndStreamingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content: string;
}
