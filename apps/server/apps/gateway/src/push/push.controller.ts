import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { PushService } from './push.service.js';
import {
  RegisterTokenDto,
  UnregisterTokenDto,
} from './dto/register-token.dto.js';

@Controller({
  path: 'push',
  version: '1',
})
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  @UseGuards(AuthGuard)
  async register(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterTokenDto,
  ): Promise<{ message: string }> {
    return this.pushService.registerToken(userId, dto.token, dto.platform);
  }

  @Delete('register')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async unregister(
    @CurrentUser('sub') userId: string,
    @Body() dto: UnregisterTokenDto,
  ): Promise<{ message: string }> {
    return this.pushService.unregisterToken(userId, dto.token);
  }
}
