import {
  IsString,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  ValidateNested,
  IsArray,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ViewConfigDto } from './view-config.dto.js';

export class UpdateViewDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ViewConfigDto)
  config?: ViewConfigDto;
}

export class ReorderViewsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  viewIds: string[];
}
