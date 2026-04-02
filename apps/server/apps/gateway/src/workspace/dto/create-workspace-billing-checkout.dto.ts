import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
}
