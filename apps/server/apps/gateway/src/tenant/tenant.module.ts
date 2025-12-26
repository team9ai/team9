import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TenantContextMiddleware } from './middleware/tenant-context.middleware';
import { TenantGuard } from './guards/tenant.guard';
import { TenantRoleGuard } from './guards/tenant-role.guard';
import { AuthModule } from '../auth/auth.module';

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
