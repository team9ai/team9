import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ErrorDetailDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsString()
  @MaxLength(2000)
  message!: string;
}

export class UpdateStatusDto {
  @IsIn(['completed', 'failed', 'timeout'])
  status!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ErrorDetailDto)
  error?: ErrorDetailDto;
}
