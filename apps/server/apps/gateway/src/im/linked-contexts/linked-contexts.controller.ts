import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { QueryLinkedContextDto } from './dto/query-linked-context.dto.js';
import {
  LinkedContextsService,
  type LinkedContextResponse,
} from './linked-contexts.service.js';

@Controller({
  path: 'im/linked-contexts',
  version: '1',
})
@UseGuards(AuthGuard)
export class LinkedContextsController {
  constructor(private readonly service: LinkedContextsService) {}

  @Get()
  async query(
    @CurrentUser('sub') userId: string,
    @Query() dto: QueryLinkedContextDto,
  ): Promise<LinkedContextResponse> {
    return this.service.query({
      userId,
      parentChannelId: dto.parentChannelId,
      ...(dto.query ? { query: dto.query } : {}),
      ...(dto.limit ? { limit: dto.limit } : {}),
      ...(dto.maxContentChars ? { maxContentChars: dto.maxContentChars } : {}),
    });
  }
}
