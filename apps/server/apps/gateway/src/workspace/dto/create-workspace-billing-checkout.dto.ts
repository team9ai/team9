import { IsNotEmpty, IsString } from 'class-validator';

export class CreateWorkspaceBillingCheckoutDto {
  @IsString()
  @IsNotEmpty()
  priceId!: string;
}
