import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService, UserResponse } from './users.service';
import { UpdateUserDto, UpdateUserStatusDto } from './dto';
import { AuthGuard, CurrentUser } from '@team9/auth';

@Controller({
  path: 'im/users',
  version: '1',
})
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async search(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ): Promise<UserResponse[]> {
    return this.usersService.search(
      query || '',
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('online')
  async getOnlineUsers(): Promise<Record<string, string>> {
    return this.usersService.getOnlineUsers();
  }

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.findByIdOrThrow(id);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(userId, dto);
  }

  @Patch('me/status')
  async updateStatus(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<{ success: boolean }> {
    await this.usersService.updateStatus(userId, dto.status);
    return { success: true };
  }
}
