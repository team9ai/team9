/// <reference types="vite/client" />

declare module "@cubone/react-file-manager";

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_EXTERNAL_IM_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
