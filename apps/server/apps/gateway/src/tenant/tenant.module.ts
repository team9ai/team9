import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { TenantController } from './tenant.controller.js';
import { TenantContextMiddleware } from './middleware/tenant-context.middleware.js';
import { TenantGuard } from './guards/tenant.guard.js';
import { TenantRoleGuard } from './guards/tenant-role.guard.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [TenantController],
  providers: [TenantService, TenantGuard, TenantRoleGuard],
  exports: [TenantService, TenantGuard, TenantRoleGuard],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
