import {
  IsString,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  IsUUID,
} from 'class-validator';

export class UpdateTabDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class ReorderTabsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  tabIds: string[];
}
