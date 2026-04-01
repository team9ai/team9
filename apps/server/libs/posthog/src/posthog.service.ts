import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { env } from '@team9/shared';

export interface PosthogCaptureInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  groups?: Record<string, string>;
  disableGeoip?: boolean;
}

export interface PosthogIdentifyInput {
  distinctId: string;
  properties?: Record<string, unknown>;
}

export interface PosthogAliasInput {
  distinctId: string;
  alias: string;
}

export interface PosthogGroupIdentifyInput {
  groupType: string;
  groupKey: string;
  properties?: Record<string, unknown>;
  distinctId?: string;
}

export interface PosthogFeatureFlagOptions {
  groups?: Record<string, string>;
  personProperties?: Record<string, string>;
  groupProperties?: Record<string, Record<string, string>>;
  onlyEvaluateLocally?: boolean;
  sendFeatureFlagEvents?: boolean;
  disableGeoip?: boolean;
}

@Injectable()
export class PosthogService implements OnApplicationShutdown {
  private readonly logger = new Logger(PosthogService.name);
  private readonly client: PostHog | null;

  constructor() {
    const projectApiKey = env.POSTHOG_PROJECT_API_KEY;

    if (!projectApiKey) {
      this.client = null;
      this.logger.log(
        'PostHog is disabled because POSTHOG_PROJECT_API_KEY is not configured',
      );
      return;
    }

    this.client = new PostHog(projectApiKey, {
      host: env.POSTHOG_HOST || 'https://us.i.posthog.com',
      personalApiKey: env.POSTHOG_FEATURE_FLAGS_SECURE_API_KEY,
      featureFlagsPollingInterval: 30000,
    });

    this.client.on('error', (error) => {
      this.logger.error('PostHog client error', error as Error);
    });

    this.logger.log('PostHog client initialized');
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  capture(input: PosthogCaptureInput): void {
    if (!this.client) {
      return;
    }

    this.client.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: input.properties,
      groups: input.groups,
      disableGeoip: input.disableGeoip,
    });
  }

  identify(input: PosthogIdentifyInput): void {
    if (!this.client) {
      return;
    }

    this.client.identify({
      distinctId: input.distinctId,
      properties: input.properties,
    });
  }

  alias(input: PosthogAliasInput): void {
    if (!this.client) {
      return;
    }

    this.client.alias({
      distinctId: input.distinctId,
      alias: input.alias,
    });
  }

  groupIdentify(input: PosthogGroupIdentifyInput): void {
    if (!this.client) {
      return;
    }

    this.client.groupIdentify({
      groupType: input.groupType,
      groupKey: input.groupKey,
      properties: input.properties,
      distinctId: input.distinctId,
    });
  }

  async getFeatureFlag(
    flagKey: string,
    distinctId: string,
    options?: PosthogFeatureFlagOptions,
  ): Promise<boolean | string | undefined> {
    if (!this.client) {
      return undefined;
    }

    return this.client.getFeatureFlag(flagKey, distinctId, options);
  }

  async reloadFeatureFlags(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.reloadFeatureFlags();
  }

  async shutdown(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.shutdown();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }
}
