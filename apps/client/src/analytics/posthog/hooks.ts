import { useMemo } from "react";
import { useTeam9PostHog } from "./provider";

export function usePostHogAnalytics() {
  const { client, enabled, ready } = useTeam9PostHog();

  return useMemo(
    () => ({
      client,
      enabled,
      ready,
      capture: (event: string, properties?: Record<string, unknown>): void => {
        client?.capture(event, properties);
      },
      identify: (
        distinctId: string,
        properties?: Record<string, unknown>,
      ): void => {
        client?.identify(distinctId, properties);
      },
      alias: (alias: string): void => {
        client?.alias(alias);
      },
      group: (
        groupType: string,
        groupKey: string,
        properties?: Record<string, unknown>,
      ): void => {
        client?.group(groupType, groupKey, properties);
      },
      reset: (resetDeviceId?: boolean): void => {
        client?.reset(resetDeviceId);
      },
      reloadFeatureFlags: (): void => {
        client?.reloadFeatureFlags();
      },
      getFeatureFlag: (flag: string) => {
        return client?.getFeatureFlag(flag);
      },
    }),
    [client, enabled, ready],
  );
}
