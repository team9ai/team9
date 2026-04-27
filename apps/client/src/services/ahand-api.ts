import http from "./http";

export interface DeviceDto {
  id: string;
  hubDeviceId: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname: string | null;
  status: "active" | "revoked";
  lastSeenAt: string | null;
  isOnline: boolean | null;
  createdAt: string;
}

export interface RegisterDeviceInput {
  hubDeviceId: string;
  publicKey: string;
  nickname: string;
  platform: "macos" | "windows" | "linux";
  hostname?: string;
}

export interface RegisterDeviceResponse {
  device: DeviceDto;
  deviceJwt: string;
  hubUrl: string;
  jwtExpiresAt: string;
}

export interface TokenRefreshResponse {
  deviceJwt: string;
  jwtExpiresAt: string;
}

export const ahandApi = {
  register(input: RegisterDeviceInput): Promise<RegisterDeviceResponse> {
    return http
      .post<RegisterDeviceResponse>("/v1/ahand/devices", input)
      .then((r) => r.data);
  },
  list(opts: { includeOffline?: boolean } = {}): Promise<DeviceDto[]> {
    const q = opts.includeOffline === false ? "?includeOffline=false" : "";
    return http.get<DeviceDto[]>(`/v1/ahand/devices${q}`).then((r) => r.data);
  },
  refreshToken(id: string): Promise<TokenRefreshResponse> {
    return http
      .post<TokenRefreshResponse>(
        `/v1/ahand/devices/${encodeURIComponent(id)}/token/refresh`,
      )
      .then((r) => r.data);
  },
  patch(id: string, body: { nickname?: string }): Promise<DeviceDto> {
    return http
      .patch<DeviceDto>(`/v1/ahand/devices/${encodeURIComponent(id)}`, body)
      .then((r) => r.data);
  },
  remove(id: string): Promise<void> {
    return http
      .delete(`/v1/ahand/devices/${encodeURIComponent(id)}`)
      .then(() => undefined);
  },
};
