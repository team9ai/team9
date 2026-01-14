import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { UsersService, UserResponse } from './users.service.js';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/index.js';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { WebsocketGateway } from '../websocket/websocket.gateway.js';
import { WS_EVENTS } from '../websocket/events/events.constants.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';

@Controller({
  path: 'im/users',
  version: '1',
})
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
  ) {}

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

    // Broadcast status change to all workspaces the user belongs to
    const workspaceIds =
      await this.workspaceService.getWorkspaceIdsByUserId(userId);
    for (const workspaceId of workspaceIds) {
      await this.websocketGateway.broadcastToWorkspace(
        workspaceId,
        WS_EVENTS.USER.STATUS_CHANGED,
        {
          userId,
          status: dto.status,
        },
      );
    }

    return { success: true };
  }
}
