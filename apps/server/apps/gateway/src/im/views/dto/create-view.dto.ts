import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ViewConfigDto } from './view-config.dto.js';

const VIEW_TYPES = ['table', 'board', 'calendar'] as const;

export class CreateViewDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsIn(VIEW_TYPES, {
    message: `type must be one of: ${VIEW_TYPES.join(', ')}`,
  })
  type: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ViewConfigDto)
  config?: ViewConfigDto;
}
