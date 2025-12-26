import { DynamicModule, Module, Logger, Type } from '@nestjs/common';
import { Edition } from './edition.enum';
import { EditionService } from './edition.service';

interface EnterpriseModuleConfig {
  name: string;
  modulePath: string;
  exportName: string;
}

const ENTERPRISE_MODULES: EnterpriseModuleConfig[] = [
  {
    name: 'TenantModule',
    modulePath: '@team9/enterprise-tenant',
    exportName: 'TenantModule',
  },
  {
    name: 'SsoModule',
    modulePath: '@team9/enterprise-sso',
    exportName: 'SsoModule',
  },
  {
    name: 'AuditModule',
    modulePath: '@team9/enterprise-audit',
    exportName: 'AuditModule',
  },
  {
    name: 'AnalyticsModule',
    modulePath: '@team9/enterprise-analytics',
    exportName: 'AnalyticsModule',
  },
  {
    name: 'LicenseModule',
    modulePath: '@team9/enterprise-license',
    exportName: 'LicenseModule',
  },
];

@Module({})
export class EditionModule {
  private static readonly logger = new Logger('EditionModule');

  static async forRootAsync(): Promise<DynamicModule> {
    const edition = (process.env.EDITION as Edition) || Edition.COMMUNITY;
    const enterpriseModules: Type[] = [];

    this.logger.log(`Initializing ${edition} edition...`);

    if (edition === Edition.ENTERPRISE) {
      const loadedModules = await this.loadEnterpriseModules();
      enterpriseModules.push(...loadedModules);
    }

    return {
      module: EditionModule,
      imports: [...enterpriseModules],
      providers: [
        EditionService,
        {
          provide: 'EDITION',
          useValue: edition,
        },
      ],
      exports: [EditionService, 'EDITION'],
      global: true,
    };
  }

  private static async loadEnterpriseModules(): Promise<Type[]> {
    const modules: Type[] = [];

    for (const config of ENTERPRISE_MODULES) {
      try {
        const mod = await import(config.modulePath);
        if (mod[config.exportName]) {
          modules.push(mod[config.exportName]);
          this.logger.log(`✓ Loaded ${config.name}`);
        }
      } catch {
        this.logger.warn(
          `✗ ${config.name} not available (enterprise module not installed)`,
        );
      }
    }

    if (modules.length === 0) {
      this.logger.warn(
        'No enterprise modules loaded. Make sure enterprise submodule is initialized.',
      );
      this.logger.warn('Run: git submodule update --init --recursive');
    }

    return modules;
  }
}
