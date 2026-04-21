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
  @Length(0, 8)
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
