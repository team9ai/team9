import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RolePatchDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class PersonaPatchDto {
  @IsIn(['append', 'replace'])
  mode!: 'append' | 'replace';

  @IsString()
  @MinLength(1)
  content!: string;
}

export class UpdateBotStaffProfileDto {
  @IsOptional()
  @IsObject()
  identityPatch?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => RolePatchDto)
  role?: RolePatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PersonaPatchDto)
  persona?: PersonaPatchDto;

  // At least one field must be present. `ValidateIf` + an always-failing
  // rule is the class-validator idiom for whole-object checks.
  @ValidateIf(
    (o: UpdateBotStaffProfileDto) =>
      o.identityPatch === undefined &&
      o.role === undefined &&
      o.persona === undefined,
  )
  @IsString({
    message:
      'At least one of identityPatch, role, or persona must be provided.',
  })
  readonly _atLeastOne?: string;
}
