import { IsOptional, IsEnum, IsUUID } from 'class-validator';

export class AddWorkspaceMemberDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsEnum(['owner', 'admin', 'member', 'guest'])
  role?: 'owner' | 'admin' | 'member' | 'guest';
}

export class UpdateMemberRoleDto {
  @IsEnum(['owner', 'admin', 'member', 'guest'])
  role: 'owner' | 'admin' | 'member' | 'guest';
}
