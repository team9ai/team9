import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AhandWebhookService } from './ahand-webhook.service.js';
import { WebhookEventDto } from './dto/webhook-event.dto.js';

@Controller('api/ahand/hub-webhook')
export class AhandHubWebhookController {
  private readonly logger = new Logger(AhandHubWebhookController.name);

  constructor(private readonly svc: AhandWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async ingest(
    @Req() req: Request,
    @Headers('x-ahand-signature') signature: string | undefined,
    @Headers('x-ahand-timestamp') timestamp: string | undefined,
    @Headers('x-ahand-event-id') eventIdHeader: string | undefined,
    @Body() body: WebhookEventDto,
  ): Promise<void> {
    // Signature verification requires the raw unmodified request body.
    // The gateway registers express.raw() for this path before json() in
    // main.ts so req.rawBody (if NestFactory rawBody option is set) or the
    // raw buffer from the middleware lands here.
    const raw: unknown =
      (req as unknown as { rawBody?: Buffer }).rawBody ?? req.body;
    if (!raw) throw new BadRequestException('Missing request body');
    const rawBuf: Buffer = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));

    this.svc.verifySignature(rawBuf, signature, timestamp);

    if (eventIdHeader && body.eventId && eventIdHeader !== body.eventId) {
      throw new BadRequestException(
        'Header X-AHand-Event-Id does not match body eventId',
      );
    }

    const fresh = await this.svc.dedupe(body.eventId);
    if (!fresh) return; // duplicate — 204 silently

    try {
      await this.svc.handleEvent(body);
    } catch (e) {
      this.logger.error(`Webhook handler failed for ${body.eventId}: ${e}`);
      await this.svc.clearDedupe(body.eventId);
      throw e;
    }
  }
}
