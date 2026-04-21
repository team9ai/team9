import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateWikiDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  slug?: string;

  @IsOptional()
  @IsString()
  // 32 UTF-16 code units: comfortably covers ZWJ-joined emoji (e.g. the
  // family emoji 👨‍👩‍👧‍👦 is 11 units, flag sequences are up to 14) without
  // allowing arbitrary free text to sneak through as an "icon". Kept in
  // sync with the create-wiki DTO.
  @Length(0, 32)
  icon?: string;

  @IsOptional()
  @IsIn(['auto', 'review'])
  approvalMode?: 'auto' | 'review';

  @IsOptional()
  @IsIn(['read', 'propose', 'write'])
  humanPermission?: 'read' | 'propose' | 'write';

  @IsOptional()
  @IsIn(['read', 'propose', 'write'])
  agentPermission?: 'read' | 'propose' | 'write';
}
