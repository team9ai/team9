import {
  Controller,
  Get,
  Param,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@team9/auth';
import { ApplicationsService } from './applications.service.js';

@Controller({
  path: 'applications',
  version: '1',
})
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  /**
   * Get all available applications.
   */
  @Get()
  findAll() {
    return this.applicationsService.findAll();
  }

  /**
   * Get an application by ID.
   */
  @Get(':id')
  findById(@Param('id') id: string) {
    const app = this.applicationsService.findById(id);
    if (!app) {
      throw new NotFoundException(`Application ${id} not found`);
    }
    return app;
  }
}
