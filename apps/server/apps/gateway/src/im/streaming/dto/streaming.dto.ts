import {
  IsString,
  IsUUID,
  IsOptional,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

export class StartStreamingDto {
  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class UpdateStreamingContentDto {
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
