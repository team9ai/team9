import { IsArray, IsUUID } from 'class-validator';

export class ReorderSectionsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  sectionIds: string[];
}
