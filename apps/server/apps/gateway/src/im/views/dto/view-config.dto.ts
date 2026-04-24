import {
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsString,
  IsIn,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { ViewFilterOperator, ViewSortDirection } from '@team9/shared';

const FILTER_OPERATORS: ViewFilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
];

const SORT_DIRECTIONS: ViewSortDirection[] = ['asc', 'desc'];

export class ViewFilterDto {
  @IsString()
  propertyKey: string;

  @IsIn(FILTER_OPERATORS)
  operator: ViewFilterOperator;

  @IsOptional()
  value?: unknown;
}

export class ViewSortDto {
  @IsString()
  propertyKey: string;

  @IsIn(SORT_DIRECTIONS)
  direction: ViewSortDirection;
}

export class ViewConfigDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Maximum 10 filters allowed' })
  @ValidateNested({ each: true })
  @Type(() => ViewFilterDto)
  filters?: ViewFilterDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3, { message: 'Maximum 3 sorts allowed' })
  @ValidateNested({ each: true })
  @Type(() => ViewSortDto)
  sorts?: ViewSortDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleProperties?: string[];

  @IsOptional()
  @IsIn(['blacklist', 'whitelist'])
  visiblePropertiesMode?: 'blacklist' | 'whitelist';

  @IsOptional()
  @IsObject()
  columnWidths?: Record<string, number>;

  @IsOptional()
  @IsString()
  groupBy?: string;

  @IsOptional()
  @IsString()
  datePropertyKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(['month', 'week', 'day'])
  defaultCalendarView?: string;

  @IsOptional()
  @IsBoolean()
  showRecurring?: boolean;
}
