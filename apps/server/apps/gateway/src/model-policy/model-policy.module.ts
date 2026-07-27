import { Global, Module } from '@nestjs/common';
import { ClawHiveModule } from '@team9/claw-hive';
import { ModelPolicyService } from './model-policy.service.js';
import { StaffModelCatalogController } from './staff-model-catalog.controller.js';

@Global()
@Module({
  imports: [ClawHiveModule],
  controllers: [StaffModelCatalogController],
  providers: [ModelPolicyService],
  exports: [ModelPolicyService],
})
export class ModelPolicyModule {}
