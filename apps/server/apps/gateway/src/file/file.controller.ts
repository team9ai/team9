import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { PresignedUploadCredentials } from '@team9/storage';
import {
  FileService,
  ConfirmUploadResult,
  DownloadUrlResult,
  FileRecord,
} from './file.service.js';
import {
  CreatePresignedUploadDto,
  ConfirmUploadDto,
  GetDownloadUrlDto,
} from './dto/index.js';
import type { FileVisibility } from './dto/index.js';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';

@Controller({
  path: 'files',
  version: '1',
})
export class FileController {
  constructor(private readonly fileService: FileService) {}

  /**
   * Get presigned upload credentials
   * Files are automatically tagged as 'pending' and will be auto-deleted after 1 day if not confirmed
   */
  @Post('presign')
  @UseGuards(AuthGuard)
  async createPresignedUpload(
    @CurrentTenantId() workspaceId: string,
    @Body() dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadCredentials> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.createPresignedUpload(workspaceId, dto);
  }

  /**
   * Confirm upload - changes tag from 'pending' to 'confirmed'
   * This saves the file record to database and makes the file permanent
   */
  @Post('confirm')
  @UseGuards(AuthGuard)
  async confirmUpload(
    @CurrentTenantId() workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ConfirmUploadDto,
  ): Promise<ConfirmUploadResult> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.confirmUpload(workspaceId, userId, dto);
  }

  /**
   * Get presigned download URL for a file
   * Validates access permissions before generating URL
   */
  @Get(':key/download-url')
  @UseGuards(AuthGuard)
  async getDownloadUrl(
    @CurrentTenantId() workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Param('key') key: string,
    @Query() query: GetDownloadUrlDto,
  ): Promise<DownloadUrlResult> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.getDownloadUrl(
      workspaceId,
      key,
      userId,
      query.expiresIn,
    );
  }

  /**
   * Get public download URL (for public files only, no auth required)
   */
  @Get('public/:key/download-url')
  async getPublicDownloadUrl(
    @CurrentTenantId() workspaceId: string,
    @Param('key') key: string,
    @Query() query: GetDownloadUrlDto,
  ): Promise<DownloadUrlResult> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.getPublicDownloadUrl(
      workspaceId,
      key,
      query.expiresIn,
    );
  }

  /**
   * Update file visibility
   */
  @Patch(':key/visibility')
  @UseGuards(AuthGuard)
  async updateVisibility(
    @CurrentTenantId() workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Param('key') key: string,
    @Body('visibility') visibility: FileVisibility,
    @Body('channelId') channelId?: string,
  ): Promise<FileRecord> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    return this.fileService.updateVisibility(
      workspaceId,
      key,
      userId,
      visibility,
      channelId,
    );
  }

  /**
   * Delete a file
   */
  @Delete(':key')
  @UseGuards(AuthGuard)
  async deleteFile(
    @CurrentTenantId() workspaceId: string,
    @CurrentUser('sub') userId: string,
    @Param('key') key: string,
  ): Promise<{ success: boolean }> {
    if (!workspaceId) {
      throw new BadRequestException('X-Tenant-Id header is required');
    }
    await this.fileService.deleteFile(workspaceId, key, userId);
    return { success: true };
  }
}
