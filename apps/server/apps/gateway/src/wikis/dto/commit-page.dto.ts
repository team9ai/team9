import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CommitFileDto {
  @IsString()
  @MaxLength(500)
  path!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsIn(['text', 'base64'])
  encoding?: 'text' | 'base64';

  @IsIn(['create', 'update', 'delete'])
  action!: 'create' | 'update' | 'delete';
}

export class CommitPageDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitFileDto)
  files!: CommitFileDto[];

  @IsOptional()
  @IsBoolean()
  propose?: boolean;
}
