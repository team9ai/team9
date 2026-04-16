import { Injectable } from '@nestjs/common';
import { Application } from './application.types.js';

/**
 * Hardcoded list of available applications.
 */
const APPLICATIONS: Application[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description:
      'AI-powered coding assistant that helps you write, review, and debug code.',
    iconUrl: '/icons/openclaw.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'custom',
    singleton: true,
    hidden: true,
  },
  {
    id: 'base-model-staff',
    name: 'Base Model Staff',
    description:
      'Create AI staff members powered by base models (Claude, ChatGPT, Gemini)',
    iconUrl: '/icons/base-model-staff.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'custom',
    singleton: true,
    autoInstall: true,
  },
  {
    id: 'common-staff',
    name: 'Common Staff',
    description: 'AI employee system with profile, role, and mentor bootstrap',
    iconUrl: '/icons/common-staff.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'managed',
    singleton: true,
    autoInstall: true,
  },
  {
    id: 'personal-staff',
    name: 'Personal Staff',
    description: 'Private AI assistant — one per user per workspace',
    iconUrl: '/icons/personal-staff.svg',
    categories: ['ai', 'bot'],
    enabled: true,
    type: 'managed',
    singleton: true,
    autoInstall: true,
  },
];

@Injectable()
export class ApplicationsService {
  /**
   * Get all enabled applications, unfiltered by visibility.
   * Internal accessor used by install handlers, metadata lookup,
   * and `findAllVisible` / `findAutoInstall`.
   */
  findAll(): Application[] {
    return APPLICATIONS.filter((app) => app.enabled);
  }

  /**
   * Get all applications visible to a tenant: excludes `hidden` apps the
   * tenant has not installed. Hidden apps the tenant already installed are
   * kept (so clients that render the full catalog can still resolve them).
   */
  findAllVisible(installedIds: Set<string>): Application[] {
    return this.findAll().filter(
      (app) => !app.hidden || installedIds.has(app.id),
    );
  }

  /**
   * Get an application by ID. Returns hidden apps too — install/uninstall
   * handlers and metadata enrichment need them.
   */
  findById(id: string): Application | undefined {
    return APPLICATIONS.find((app) => app.id === id && app.enabled);
  }

  /**
   * Get all applications that should be auto-installed when a workspace
   * is created. Hidden apps are always excluded.
   */
  findAutoInstall(): Application[] {
    return APPLICATIONS.filter(
      (app) => app.autoInstall && app.enabled && !app.hidden,
    );
  }
}
