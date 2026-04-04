import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PushSubscriptionService } from './push-subscription.service.js';
import { SubscribePushDto, UnsubscribePushDto } from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { env } from '@team9/shared';
import type { Request } from 'express';

@Controller({
  path: 'push-subscriptions',
  version: '1',
})
export class PushSubscriptionController {
  constructor(
    private readonly pushSubscriptionService: PushSubscriptionService,
  ) {}

  /**
   * GET /v1/push-subscriptions/vapid-public-key
   * Returns the VAPID public key for the client to use when subscribing.
   * No auth required — frontend needs this before subscribing.
   */
  @Get('vapid-public-key')
  getVapidPublicKey(): { publicKey: string } {
    const publicKey = env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      throw new ServiceUnavailableException(
        'Push notifications are not configured',
      );
    }
    return { publicKey };
  }

  /**
   * POST /v1/push-subscriptions
   * Subscribe to push notifications
   */
  @Post()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async subscribe(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubscribePushDto,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const userAgent = req.headers['user-agent'];
    const subscription = await this.pushSubscriptionService.subscribe(
      userId,
      dto,
      userAgent,
    );
    return { id: subscription.id };
  }

  /**
   * DELETE /v1/push-subscriptions
   * Unsubscribe from push notifications
   */
  @Delete()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UnsubscribePushDto,
  ): Promise<{ success: boolean }> {
    await this.pushSubscriptionService.unsubscribe(dto.endpoint, userId);
    return { success: true };
  }
}
