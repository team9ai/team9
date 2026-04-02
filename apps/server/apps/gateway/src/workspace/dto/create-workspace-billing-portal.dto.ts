import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateWorkspaceBillingPortalDto {
  @IsOptional()
  @IsString()
  @IsIn(['plans', 'credits'])
  view?: 'plans' | 'credits';
}
