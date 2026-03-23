import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class StartStreamingDto {
  @IsUUID()
  senderId: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;
}

export class UpdateStreamingContentDto {
  @IsString()
  @MaxLength(100000)
  content: string;
}

export class EndStreamingDto {
  @IsString()
  @MaxLength(100000)
  content: string;
}
