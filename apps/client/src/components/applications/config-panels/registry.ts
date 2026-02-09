import type { ComponentType } from "react";
import type { InstalledApplication } from "@/services/api/applications";

export interface AppConfigPanelProps {
  installedApp: InstalledApplication;
}

export interface ConfigTabDefinition {
  value: string;
  label: string;
  Component: ComponentType<AppConfigPanelProps>;
}

const registry: Record<string, ConfigTabDefinition[]> = {};

export function registerConfigTabs(
  applicationId: string,
  tabs: ConfigTabDefinition[],
) {
  registry[applicationId] = tabs;
}

export function getConfigTabs(
  applicationId: string,
): ConfigTabDefinition[] | undefined {
  return registry[applicationId];
}
