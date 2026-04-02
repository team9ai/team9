import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Request } from 'express';
import { WorkspaceService } from '../workspace.service.js';

interface WorkspaceRequest extends Request {
  params: {
    workspaceId?: string;
    id?: string;
  };
  tenantId?: string;
  user?: {
    sub: string;
  };
  workspaceRole?: string;
  tenantRole?: string;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => WorkspaceService))
    private readonly workspaceService: WorkspaceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();

    // Get workspace ID from route param or tenantId from middleware
    // Priority: workspaceId param > tenantId from header > id param (for backward compatibility)
    const workspaceId =
      request.params.workspaceId ?? request.tenantId ?? request.params.id;
    const user = request.user;

    if (!workspaceId) {
      throw new ForbiddenException('Workspace context required');
    }

    if (!user) {
      // Auth guard should handle this
      return true;
    }

    // Verify user is a member of the workspace
    const isMember = await this.workspaceService.isWorkspaceMember(
      workspaceId,
      user.sub,
    );
    if (!isMember) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    // Attach workspace role to request
    const role = await this.workspaceService.getMemberRole(
      workspaceId,
      user.sub,
    );
    request.workspaceRole = role ?? undefined;
    request.tenantRole = role ?? undefined; // For backward compatibility

    return true;
  }
}
