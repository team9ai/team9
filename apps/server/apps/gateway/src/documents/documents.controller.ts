import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { DocumentIdentity } from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { DocumentsService } from './documents.service.js';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  SubmitSuggestionDto,
  ReviewSuggestionDto,
  UpdatePrivilegesDto,
} from './dto/index.js';

@Controller({
  path: 'documents',
  version: '1',
})
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  async create(
    @Body() dto: CreateDocumentDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Req() req: any,
  ) {
    const identity = this.getCallerIdentity(userId, req);
    return this.documentsService.create(dto, identity, tenantId);
  }

  @Get()
  async list(@CurrentTenantId() tenantId: string) {
    return this.documentsService.list(tenantId);
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getById(id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const identity = this.getCallerIdentity(userId, req);
    return this.documentsService.update(id, dto, identity);
  }

  @Patch(':id/privileges')
  async updatePrivileges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrivilegesDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const identity = this.getCallerIdentity(userId, req);
    await this.documentsService.updatePrivileges(id, dto.privileges, identity);
    return { success: true };
  }

  @Get(':id/versions')
  async getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getVersions(id);
  }

  @Get(':id/versions/:versionIndex')
  async getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionIndex', ParseIntPipe) versionIndex: number,
  ) {
    return this.documentsService.getVersion(id, versionIndex);
  }

  @Post(':id/suggestions')
  async submitSuggestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitSuggestionDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const identity = this.getCallerIdentity(userId, req);
    return this.documentsService.submitSuggestion(id, dto, identity);
  }

  @Get(':id/suggestions')
  async getSuggestions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
  ) {
    return this.documentsService.getSuggestions(id, status);
  }

  @Get(':id/suggestions/:sugId')
  async getSuggestionDetail(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('sugId', ParseUUIDPipe) sugId: string,
  ) {
    return this.documentsService.getSuggestionWithDiff(sugId);
  }

  @Post(':id/suggestions/:sugId/review')
  async reviewSuggestion(
    @Param('sugId', ParseUUIDPipe) sugId: string,
    @Body() dto: ReviewSuggestionDto,
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const identity = this.getCallerIdentity(userId, req);
    return this.documentsService.reviewSuggestion(sugId, dto.action, identity);
  }

  /**
   * Determine caller identity from auth header.
   * Bot tokens use 't9bot_' prefix; everything else is a human user.
   */
  private getCallerIdentity(userId: string, req: any): DocumentIdentity {
    const authHeader: string | undefined = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer t9bot_')) {
      return { type: 'bot', id: userId };
    }
    return { type: 'user', id: userId };
  }
}
