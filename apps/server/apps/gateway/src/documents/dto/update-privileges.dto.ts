import { IsArray } from 'class-validator';
import type { DocumentPrivilege } from '@team9/database/schemas';

export class UpdatePrivilegesDto {
  @IsArray()
  privileges: DocumentPrivilege[];
}
