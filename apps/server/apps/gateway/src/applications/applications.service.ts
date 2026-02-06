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
    type: 'managed',
    singleton: true,
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
}
