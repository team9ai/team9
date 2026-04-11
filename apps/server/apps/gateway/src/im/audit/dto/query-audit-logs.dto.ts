import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAuditLogsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['channel', 'message'])
  entityType?: string;

  @IsOptional()
  @IsIn([
    'created',
    'updated',
    'deleted',
    'property_defined',
    'property_schema_updated',
    'property_deleted',
    'property_set',
    'property_updated',
    'property_removed',
  ])
  action?: string;
}
