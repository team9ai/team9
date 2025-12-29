import { Injectable, Logger } from '@nestjs/common';
import {
  Edition,
  EditionConfig,
  FeatureFlag,
  EDITION_CONFIGS,
} from './edition.enum.js';

@Injectable()
export class EditionService {
  private readonly logger = new Logger(EditionService.name);
  private readonly edition: Edition;
  private readonly config: EditionConfig;
  private readonly enabledFeatures: Set<FeatureFlag>;

  constructor() {
    this.edition = (process.env.EDITION as Edition) || Edition.COMMUNITY;
    this.config = EDITION_CONFIGS[this.edition];
    this.enabledFeatures = new Set(this.config.features);

    this.logger.log(`Running ${this.config.name}`);
    this.logger.log(`Max users: ${this.config.maxUsers}`);
    this.logger.log(`Max channels: ${this.config.maxChannels}`);
    this.logger.log(`Features enabled: ${this.config.features.length}`);
  }

  getEdition(): Edition {
    return this.edition;
  }

  getConfig(): EditionConfig {
    return this.config;
  }

  isEnterprise(): boolean {
    return this.edition === Edition.ENTERPRISE;
  }

  isCommunity(): boolean {
    return this.edition === Edition.COMMUNITY;
  }

  hasFeature(feature: FeatureFlag): boolean {
    return this.enabledFeatures.has(feature);
  }

  hasAllFeatures(features: FeatureFlag[]): boolean {
    return features.every((f) => this.enabledFeatures.has(f));
  }

  hasAnyFeature(features: FeatureFlag[]): boolean {
    return features.some((f) => this.enabledFeatures.has(f));
  }

  getEnabledFeatures(): FeatureFlag[] {
    return Array.from(this.enabledFeatures);
  }

  getMaxUsers(): number {
    return this.config.maxUsers;
  }

  getMaxChannels(): number {
    return this.config.maxChannels;
  }

  getMaxStorageMB(): number {
    return this.config.maxStorageMB;
  }
}
