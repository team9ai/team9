import { toDataURL } from "qrcode";

const EXTERNAL_IM_GATEWAY_BASE_URL = (
  import.meta.env.VITE_EXTERNAL_IM_GATEWAY_URL || "http://localhost:3719"
).replace(/\/$/, "");

export type WeixinIlinkLoginStatus =
  | "wait"
  | "scaned"
  | "scaned_but_redirect"
  | "confirmed"
  | "binded_redirect"
  | "expired";

export interface WeixinIlinkLoginSession {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  status: WeixinIlinkLoginStatus;
  expiresAt: string;
}

export interface WeixinIlinkConnection {
  id: string;
  provider: "weixin-ilink";
  externalTenantId: string;
  baseUrl: string;
  ilinkBotId?: string;
  ilinkUserId?: string;
  team9UserId?: string;
  team9TenantId?: string;
  defaultExternalConversationId?: string;
  status: "active" | "paused" | "expired" | "error";
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  polling: boolean;
}

export interface WeixinIlinkLoginStatusResult {
  sessionKey: string;
  status: WeixinIlinkLoginStatus;
  connected: boolean;
  alreadyConnected?: boolean;
  connection?: WeixinIlinkConnection;
  message?: string;
}

interface GatewayEnvelope<T> {
  ok: boolean;
  error?: string;
  session?: T;
  status?: T;
  connections?: T;
}

async function requestGateway<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${EXTERNAL_IM_GATEWAY_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response
    .json()
    .catch(() => null)) as GatewayEnvelope<T> | null;

  if (!response.ok || body?.ok === false) {
    throw new Error(
      body?.error || `External IM gateway request failed: ${response.status}`,
    );
  }

  return (body?.session ?? body?.status ?? body?.connections ?? body) as T;
}

export const externalImGatewayApi = {
  startWeixinIlinkLogin: async (input: {
    team9UserId: string;
    team9TenantId?: string;
    force?: boolean;
  }): Promise<WeixinIlinkLoginSession> => {
    return requestGateway<WeixinIlinkLoginSession>(
      "/providers/weixin-ilink/login",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  getWeixinIlinkLoginStatus: async (
    sessionKey: string,
  ): Promise<WeixinIlinkLoginStatusResult> => {
    return requestGateway<WeixinIlinkLoginStatusResult>(
      `/providers/weixin-ilink/login/${encodeURIComponent(sessionKey)}/status`,
    );
  },

  listWeixinIlinkConnections: async (): Promise<WeixinIlinkConnection[]> => {
    return requestGateway<WeixinIlinkConnection[]>(
      "/providers/weixin-ilink/connections",
    );
  },
};

const QR_IMAGE_BASE64_PREFIXES: Array<{ prefix: string; mimeType: string }> = [
  { prefix: "iVBORw0KGgo", mimeType: "image/png" },
  { prefix: "/9j/", mimeType: "image/jpeg" },
  { prefix: "UklGR", mimeType: "image/webp" },
  { prefix: "R0lGOD", mimeType: "image/gif" },
];

function looksLikeBase64Payload(value: string) {
  if (value.length < 32) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export async function createWeixinQrImageSrc(
  qrcodeContent: string,
): Promise<string> {
  const value = qrcodeContent.trim();
  if (!value) return value;
  if (/^data:image\//i.test(value)) return value;
  const compactValue = value.replace(/\s/g, "");
  const imagePayload = QR_IMAGE_BASE64_PREFIXES.find(({ prefix }) =>
    compactValue.startsWith(prefix),
  );
  if (imagePayload) {
    return `data:${imagePayload.mimeType};base64,${compactValue}`;
  }
  if (looksLikeBase64Payload(compactValue)) {
    throw new Error("Unsupported Weixin QR image payload format.");
  }

  return toDataURL(value, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
