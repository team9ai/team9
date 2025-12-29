import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthResponse, TokenPair } from './auth.service.js';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { JwtPayload } from '@team9/auth';

@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
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
    @CurrentUser('sub') userId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.logout(userId);
    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }
}
