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
];

@Injectable()
export class ApplicationsService {
  /**
   * Get all available applications.
   */
  findAll(): Application[] {
    return APPLICATIONS.filter((app) => app.enabled);
  }

  /**
   * Get an application by ID.
   */
  findById(id: string): Application | undefined {
    return APPLICATIONS.find((app) => app.id === id && app.enabled);
  }

  /**
   * Get all applications that should be auto-installed when a workspace is created.
   */
  findAutoInstall(): Application[] {
    return APPLICATIONS.filter((app) => app.autoInstall && app.enabled);
  }
}
