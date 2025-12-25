import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthResponse, TokenPair } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './decorators/current-user.decorator';

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
