import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PostHogProvider } from "@posthog/react";
import type { PostHog } from "posthog-js";
import { getPostHogBrowserClient } from "./client";
import { isPostHogBrowserEnabled } from "./config";
import { Team9PostHogIdentitySync } from "./sync";

interface Team9PostHogContextValue {
  client: PostHog | null;
  enabled: boolean;
  ready: boolean;
}

const Team9PostHogContext = createContext<Team9PostHogContextValue>({
  client: null,
  enabled: isPostHogBrowserEnabled,
  ready: false,
});

export function Team9PostHogProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<PostHog | null>(null);

  useEffect(() => {
    if (!isPostHogBrowserEnabled) {
      return;
    }

    let isMounted = true;

    void getPostHogBrowserClient().then((resolvedClient) => {
      if (isMounted) {
        setClient(resolvedClient);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const value: Team9PostHogContextValue = {
    client,
    enabled: isPostHogBrowserEnabled,
    ready: client !== null,
  };

  if (!client) {
    return (
      <Team9PostHogContext.Provider value={value}>
        <Team9PostHogIdentitySync />
        {children}
      </Team9PostHogContext.Provider>
    );
  }

  return (
    <Team9PostHogContext.Provider value={value}>
      <PostHogProvider client={client}>
        <Team9PostHogIdentitySync />
        {children}
      </PostHogProvider>
    </Team9PostHogContext.Provider>
  );
}

export const useTeam9PostHog = () => useContext(Team9PostHogContext);
