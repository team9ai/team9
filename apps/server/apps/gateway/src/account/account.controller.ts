import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Body,
  UseGuards,
  Redirect,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { env } from '@team9/shared';
import { AccountService } from './account.service.js';
import { ConfirmEmailChangeDto, CreateEmailChangeDto } from './dto/index.js';
import type {
  EmailChangeMutationResponse,
  PendingEmailChangeResponse,
} from './account.service.js';

@Controller({
  path: 'account',
  version: '1',
})
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('email-change')
  @UseGuards(AuthGuard)
  async getPendingEmailChange(
    @CurrentUser('sub') userId: string,
  ): Promise<PendingEmailChangeResponse> {
    return this.accountService.getPendingEmailChange(userId);
  }

  @Post('email-change')
  @UseGuards(AuthGuard)
  async createEmailChange(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateEmailChangeDto,
  ): Promise<EmailChangeMutationResponse> {
    return this.accountService.createEmailChange(userId, dto);
  }

  @Post('email-change/resend')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async resendEmailChange(
    @CurrentUser('sub') userId: string,
  ): Promise<EmailChangeMutationResponse> {
    return this.accountService.resendEmailChange(userId);
  }

  @Delete('email-change')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelEmailChange(
    @CurrentUser('sub') userId: string,
  ): Promise<{ message: string }> {
    return this.accountService.cancelEmailChange(userId);
  }

  @Get('confirm-email-change')
  @Redirect()
  async redirectConfirmEmailChange(
    @Query() dto: ConfirmEmailChangeDto,
  ): Promise<{ url: string }> {
    return {
      url: `${env.APP_URL}/confirm-email-change?token=${encodeURIComponent(dto.token)}`,
    };
  }

  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<{ message: string }> {
    return this.accountService.confirmEmailChange(dto.token);
  }
}
