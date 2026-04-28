import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One file in a routine folder commit. Mirrors the wiki side's
 * {@link CommitPageDto}'s `CommitFileDto` shape — kept in lockstep so
 * client code (especially the upcoming `routineFolderApi`) speaks the
 * same wire format as the wiki proxy without adapter glue.
 */
export class FolderCommitFileDto {
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

/**
 * Request body for `POST /v1/routines/:id/folder/commit`.
 *
 * The `propose` flag is a CLIENT HINT only. The server computes the
 * effective propose flag from `(folder.approval_mode, currentUser
 * permission)` per spec §12 and may force `propose: true` even when
 * the client passes `false`. v1 routines are always `approval_mode:
 * "auto"` so the effective flag is always `false`; the structure is
 * wired so flipping a routine to review mode later activates the
 * propose path with no controller/service changes.
 */
export class FolderCommitDto {
  @IsString()
  // Same 4000-char ceiling as `CommitPageDto.message` — accommodates
  // proposal flows that concatenate title + description into one body.
  @MaxLength(4000)
  message!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FolderCommitFileDto)
  files!: FolderCommitFileDto[];

  /**
   * Client-side hint. Server-side the propose flag is recomputed from
   * the folder's `approval_mode`; this field is reserved for future
   * use (e.g. allowing a write-permission user to deliberately route
   * a change through review).
   */
  @IsOptional()
  propose?: boolean;
}
