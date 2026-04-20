import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type {
  AuthResponse,
  TokenPair,
  AuthStartResponse,
  DesktopSessionResponse,
  PollLoginResponse,
} from './auth.service.js';
import {
  RefreshTokenDto,
  VerifyEmailDto,
  ResendVerificationDto,
  GoogleLoginDto,
  PollLoginDto,
  AuthStartDto,
  VerifyCodeDto,
  CompleteDesktopSessionDto,
  LogoutDto,
} from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { JwtPayload } from '@team9/auth';
import type { Request } from 'express';

@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  // --- New unified auth flow ---

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async authStart(
    @Body() dto: AuthStartDto,
    @Req() req: Request,
  ): Promise<AuthStartResponse> {
    return this.authService.authStart(dto, this.getClientIp(req));
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  async verifyCode(@Body() dto: VerifyCodeDto): Promise<AuthResponse> {
    return this.authService.verifyCode(dto);
  }

  @Post('create-desktop-session')
  @HttpCode(HttpStatus.CREATED)
  async createDesktopSession(
    @Req() req: Request,
  ): Promise<DesktopSessionResponse> {
    return this.authService.createDesktopSession(this.getClientIp(req));
  }

  @Post('complete-desktop-session')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeDesktopSession(
    @Body() dto: CompleteDesktopSessionDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    return this.authService.completeDesktopSession(dto, userId);
  }

  @Get('verify-email')
  async verifyEmail(@Query() dto: VerifyEmailDto): Promise<AuthResponse> {
    return this.authService.verifyEmail(dto.token);
  }

  @Get('poll-login')
  async pollLogin(
    @Query() dto: PollLoginDto,
    @Req() req: Request,
  ): Promise<PollLoginResponse> {
    return this.authService.pollLogin(dto.sessionId, this.getClientIp(req));
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto): Promise<AuthResponse> {
    return this.authService.googleLogin(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string; verificationLink?: string }> {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.logout(userId, dto.refreshToken);
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    try {
      return await this.authService.getUserById(user.sub);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        throw error;
      }

      return this.authService.getUserByClaims({
        email: user.email,
        username: user.username,
      });
    }
  }
}
