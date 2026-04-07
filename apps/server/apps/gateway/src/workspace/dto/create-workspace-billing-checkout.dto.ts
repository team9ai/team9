import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWorkspaceBillingCheckoutDto {
  @IsString()
  @IsNotEmpty()
  priceId!: string;

  @IsOptional()
  @IsString()
  @IsIn(['subscription', 'one_time'])
  type?: 'subscription' | 'one_time';

  @IsOptional()
  @IsString()
  @IsIn(['plans', 'credits'])
  view?: 'plans' | 'credits';

  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^\/(?!\/).*/, {
    message: 'successPath must be an app-relative path',
  })
  successPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^\/(?!\/).*/, {
    message: 'cancelPath must be an app-relative path',
  })
  cancelPath?: string;
}
