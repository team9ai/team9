import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateWorkspaceBillingPortalDto {
  @IsOptional()
  @IsString()
  @IsIn(['plans', 'credits'])
  view?: 'plans' | 'credits';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^\/(?!\/).*/, {
    message: 'returnPath must be an app-relative path',
  })
  returnPath?: string;
}
