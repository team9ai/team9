import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type { DmOutboundPolicyMode } from '@team9/database/schemas';

const DM_MODES: DmOutboundPolicyMode[] = [
  'owner-only',
  'same-tenant',
  'whitelist',
  'anyone',
];

export class DmOutboundPolicyDto {
  @IsIn(DM_MODES, { message: 'INVALID_DM_POLICY_MODE' })
  mode!: DmOutboundPolicyMode;

  @ValidateIf((o) => o.mode === 'whitelist')
  @IsArray()
  @ArrayMinSize(1, { message: 'WHITELIST_EMPTY' })
  @ArrayMaxSize(50, { message: 'WHITELIST_TOO_LARGE' })
  @IsUUID('all', { each: true })
  @IsOptional()
  userIds?: string[];
}
