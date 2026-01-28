import { IsUUID, IsOptional, IsInt, Min } from 'class-validator';

export class MoveChannelDto {
  @IsUUID()
  @IsOptional()
  sectionId?: string | null;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
