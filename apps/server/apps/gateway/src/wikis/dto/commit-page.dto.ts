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
  // 4000 chars: folder9's de facto commit-message ceiling and roughly
  // git's own practical cap. 500 was too tight once review mode started
  // concatenating a proposal title + description body into `message`, and
  // image-upload commits on the shape `Upload <filename>` can easily
  // overflow with long filenames.
  @MaxLength(4000)
  message!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitFileDto)
  files!: CommitFileDto[];

  @IsOptional()
  @IsBoolean()
  propose?: boolean;
}
