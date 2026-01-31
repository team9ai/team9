import { IsOptional, IsUrl, IsObject } from 'class-validator';

export class UpdateWebhookDto {
  @IsUrl()
  @IsOptional()
  webhookUrl?: string | null;

  @IsObject()
  @IsOptional()
  webhookHeaders?: Record<string, string> | null;
}
