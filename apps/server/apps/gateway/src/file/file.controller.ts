import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { PresignedUploadCredentials, FileInfo } from '@team9/storage';
import { FileService } from './file.service.js';
import { CreatePresignedUploadDto, ConfirmUploadDto } from './dto/index.js';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';

@Controller({
  path: 'files',
  version: '1',
})
@UseGuards(AuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  /**
   * Get presigned upload credentials
   * Files are automatically tagged as 'pending' and will be auto-deleted after 1 day if not confirmed
   */
  @Post('presign')
  async createPresignedUpload(
    @CurrentTenantId() workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadCredentials> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.createPresignedUpload(workspaceId, userId, dto);
  }

  /**
   * Confirm upload - changes tag from 'pending' to 'confirmed'
   * This prevents auto-deletion and makes the file permanent
   */
  @Post('confirm')
  async confirmUpload(
    @CurrentTenantId() workspaceId: string,
    @Body() dto: ConfirmUploadDto,
  ): Promise<FileInfo> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.confirmUpload(workspaceId, dto.key);
  }

  @Delete(':key(*)')
  async deleteFile(
    @CurrentTenantId() workspaceId: string,
    @Param('key') key: string,
  ): Promise<{ success: boolean }> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    await this.fileService.deleteFile(workspaceId, key);
    return { success: true };
  }
}
