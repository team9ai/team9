import { IsIn, IsUUID, IsOptional, IsObject } from 'class-validator';

export class AuthorizeResourceDto {
  @IsIn(['user', 'task'] as const)
  granteeType: 'user' | 'task';

  @IsUUID()
  granteeId: string;

  @IsObject()
  @IsOptional()
  permissions?: { level: 'full' | 'readonly' };
}

export class RevokeResourceDto {
  @IsIn(['user', 'task'] as const)
  granteeType: 'user' | 'task';

  @IsUUID()
  granteeId: string;
}
