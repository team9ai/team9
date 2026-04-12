import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsDefined,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PropertyEntry {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key: string;

  @IsDefined({ message: 'value must be defined' })
  value: unknown;
}

export class BatchSetPropertiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyEntry)
  properties: PropertyEntry[];
}
